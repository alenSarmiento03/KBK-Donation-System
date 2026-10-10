export default function handler(request, response) {
    if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return response.status(405).json({ error: 'Method not allowed.' });
    }

    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
        response.setHeader('Cache-Control', 'no-store');
        return response.status(500).json({
            error: 'Set SUPABASE_URL and SUPABASE_ANON_KEY in the Vercel project settings.'
        });
    }

    let projectUrl;
    try {
        projectUrl = new URL(url);
    } catch {
        return response.status(500).json({ error: 'SUPABASE_URL must be a valid Supabase project URL.' });
    }
    if (projectUrl.protocol !== 'https:' || !projectUrl.hostname.endsWith('.supabase.co')
        || projectUrl.pathname !== '/' || projectUrl.search || projectUrl.hash) {
        return response.status(500).json({
            error: 'SUPABASE_URL must be the HTTPS project URL, without an API path or query.'
        });
    }

    if (anonKey.startsWith('sb_secret_')) {
        return response.status(500).json({
            error: 'SUPABASE_ANON_KEY must be a publishable/anon key, never a secret or service-role key.'
        });
    }
    if (anonKey.split('.').length === 3) {
        try {
            const payload = JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64url').toString());
            if (payload.role === 'service_role') {
                return response.status(500).json({
                    error: 'SUPABASE_ANON_KEY must not be a service-role key.'
                });
            }
        } catch {
            return response.status(500).json({ error: 'SUPABASE_ANON_KEY is not a valid publishable/anon key.' });
        }
    }

    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return response.status(200).send(
        `window.KBK_SUPABASE_CONFIG = ${JSON.stringify({ url: projectUrl.origin, anonKey })};`
    );
}
