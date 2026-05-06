const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  : null;

if (!supabase) console.log('\n  Warning: No Supabase credentials set.\n');
else console.log('\n  Supabase connected.\n');

// Retry helper - tries up to 3 times
async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}

async function getVal(key) {
  if (!supabase) return null;
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('journal_store')
      .select('value')
      .eq('key', key)
      .single();
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found, that's ok
    return data?.value ?? null;
  });
}

async function setVal(key, value) {
  if (!supabase) throw new Error('No Supabase connection');
  return withRetry(async () => {
    const { error } = await supabase
      .from('journal_store')
      .upsert({ key, value }, { onConflict: 'key' });
    if (error) throw error;
  });
}

app.get('/api/trades', async (req, res) => {
  try {
    const data = await getVal('trades');
    res.json(data || []);
  } catch (e) {
    console.error('GET trades error:', e.message);
    res.status(500).json({ error: 'Failed to load trades: ' + e.message });
  }
});

app.post('/api/trades', async (req, res) => {
  try {
    await setVal('trades', req.body);
    res.json({ success: true });
  } catch (e) {
    console.error('POST trades error:', e.message);
    res.status(500).json({ error: 'Failed to save trades: ' + e.message });
  }
});

app.get('/api/daily', async (req, res) => {
  try {
    const data = await getVal('daily');
    res.json(data || []);
  } catch (e) {
    console.error('GET daily error:', e.message);
    res.status(500).json({ error: 'Failed to load daily entries: ' + e.message });
  }
});

app.post('/api/daily', async (req, res) => {
  try {
    await setVal('daily', req.body);
    res.json({ success: true });
  } catch (e) {
    console.error('POST daily error:', e.message);
    res.status(500).json({ error: 'Failed to save daily entries: ' + e.message });
  }
});

app.get('/api/export', async (req, res) => {
  try {
    const [trades, daily] = await Promise.all([getVal('trades'), getVal('daily')]);
    res.json({ version: 2, exportedAt: new Date().toISOString(), trades: trades || [], dailyEntries: daily || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/import', async (req, res) => {
  try {
    const incoming = req.body;
    if (!incoming.trades || !Array.isArray(incoming.trades))
      return res.status(400).json({ error: 'Invalid file' });

    const currentTrades = await getVal('trades') || [];
    const existingIds = new Set(currentTrades.map(t => t.id));
    const newTrades = incoming.trades.filter(t => !existingIds.has(t.id));
    const merged = [...currentTrades, ...newTrades]
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    await setVal('trades', merged);

    if (incoming.dailyEntries) {
      const currentDaily = await getVal('daily') || [];
      const eid = new Set(currentDaily.map(d => d.id));
      const nd = incoming.dailyEntries.filter(d => !eid.has(d.id));
      const mergedDaily = [...currentDaily, ...nd].sort((a, b) => b.date.localeCompare(a.date));
      await setVal('daily', mergedDaily);
    }
    res.json({ success: true, newTrades: newTrades.length });
  } catch (e) {
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await getVal('__health_check__');
    res.json({ status: 'ok', db: 'supabase' });
  } catch (e) {
    res.json({ status: 'ok', db: 'error: ' + e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`  Trading Journal running on port ${PORT}\n`);
});
