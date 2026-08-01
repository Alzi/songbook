import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.headers['x-app-password'] !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('songs').select('*').order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'PUT') {
    const songs = req.body;
    const { error: delErr } = await supabase.from('songs').delete().neq('id', '__none__');
    if (delErr) return res.status(500).json({ error: delErr.message });
    if (songs.length) {
      const { error } = await supabase.from('songs').insert(songs);
      if (error) return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}