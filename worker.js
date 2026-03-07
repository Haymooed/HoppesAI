export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json', ...cors }
    });

    // ── GET /api/config
    if (url.pathname === '/api/config' && request.method === 'GET') {
      return json({ supabaseUrl: env.SUPABASE_URL, supabaseAnon: env.SUPABASE_ANON_KEY });
    }

    // ── POST /api/chat
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        // Auth check
        const token = request.headers.get('X-User-Token');
        if (!token) return json({ error: 'Unauthorized' }, 401);

        // Get user profile via Supabase
        const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
          headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
        });
        if (!userRes.ok) return json({ error: 'Unauthorized' }, 401);
        const user = await userRes.json();

        // Get profile with message count
        const profRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=tier,daily_msgs,msgs_reset_at`,
          { headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
        );
        const [profile] = await profRes.json();
        if (!profile) return json({ error: 'Profile not found' }, 404);

        // Reset daily count if past midnight
        const now = new Date();
        const resetAt = new Date(profile.msgs_reset_at);
        const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let dailyMsgs = profile.daily_msgs;
        if (resetAt < todayMidnight) {
          dailyMsgs = 0;
          await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`, {
            method: 'PATCH',
            headers: {
              'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json', 'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ daily_msgs: 0, msgs_reset_at: now.toISOString() })
          });
        }

        // Check limit for free users
        const DAILY_LIMIT = 50;
        if (profile.tier === 'free' && dailyMsgs >= DAILY_LIMIT) {
          // Calculate time until midnight
          const midnight = new Date(todayMidnight.getTime() + 86400000);
          const msUntil = midnight - now;
          const hrs = Math.floor(msUntil / 3600000);
          const mins = Math.floor((msUntil % 3600000) / 60000);
          return json({ error: 'limit_reached', resetIn: `${hrs}h ${mins}m` }, 429);
        }

        // Choose model based on tier
        const body = await request.json();
        const model = profile.tier === 'pro'
          ? 'llama-3.3-70b-versatile'   // NovaAI Pro
          : 'llama-3.1-8b-instant';   // NovaAI Free

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.GROQ_API_KEY}`,
            'Content-Type': 'application/json', 'Accept': 'application/json',
          },
          body: JSON.stringify({ ...body, model })
        });
        const data = await res.json();

        // Increment message count
        await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`, {
          method: 'PATCH',
          headers: {
            'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json', 'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ daily_msgs: dailyMsgs + 1, msgs_reset_at: profile.msgs_reset_at })
        });

        return new Response(JSON.stringify({ ...data, _dailyMsgs: dailyMsgs + 1 }), {
          status: res.status, headers: { 'Content-Type': 'application/json', ...cors }
        });
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── POST /api/admin/set-tier (admin only)
    if (url.pathname === '/api/admin/set-tier' && request.method === 'POST') {
      try {
        const token = request.headers.get('X-User-Token');
        if (!token) return json({ error: 'Unauthorized' }, 401);

        // Verify requester is admin
        const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
          headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
        });
        const user = await userRes.json();
        const adminRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=is_admin`,
          { headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
        );
        const [admin] = await adminRes.json();
        if (!admin?.is_admin) return json({ error: 'Forbidden' }, 403);

        const { targetUserId, tier } = await request.json();
        if (!['free', 'pro'].includes(tier)) return json({ error: 'Invalid tier' }, 400);

        await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${targetUserId}`, {
          method: 'PATCH',
          headers: {
            'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json', 'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ tier })
        });
        return json({ success: true });
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── GET /api/admin/users (admin only)
    if (url.pathname === '/api/admin/users' && request.method === 'GET') {
      try {
        const token = request.headers.get('X-User-Token');
        if (!token) return json({ error: 'Unauthorized' }, 401);

        const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
          headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
        });
        const user = await userRes.json();
        const adminRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=is_admin`,
          { headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
        );
        const [admin] = await adminRes.json();
        if (!admin?.is_admin) return json({ error: 'Forbidden' }, 403);

        const usersRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/profiles?select=id,username,display_name,tier,daily_msgs,is_admin,avatar_color&order=created_at.desc`,
          { headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
        );
        const users = await usersRes.json();
        return json(users);
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
}
