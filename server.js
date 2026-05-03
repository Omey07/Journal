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

if (!supabase) console.log('\n  Warning: No Supabase credentials. Using in-memory storage.\n');

async function getVal(key) {
  if (!supabase) return null;
  const { data } = await supabase.from('journal_store').select('value').eq('key', key).single();
  return data?.value ?? null;
}

async function setVal(key, value) {
  if (!supabase) return;
  await supabase.from('journal_store').upsert({ key, value }, { onConflict: 'key' });
}

const mem = { trades: [], daily: [] };

app.get('/api/trades', async (req, res) => {
  res.json(supabase ? (await getVal('trades') || []) : mem.trades);
});

app.post('/api/trades', async (req, res) => {
  if (supabase) await setVal('trades', req.body); else mem.trades = req.body;
  res.json({ success: true });
});

app.get('/api/daily', async (req, res) => {
  res.json(supabase ? (await getVal('daily') || []) : mem.daily);
});

app.post('/api/daily', async (req, res) => {
  if (supabase) await setVal('daily', req.body); else mem.daily = req.body;
  res.json({ success: true });
});

app.get('/api/export', async (req, res) => {
  const trades = supabase ? (await getVal('trades') || []) : mem.trades;
  const daily = supabase ? (await getVal('daily') || []) : mem.daily;
  res.json({ version: 2, exportedAt: new Date().toISOString(), trades, dailyEntries: daily });
});

app.post('/api/import', async (req, res) => {
  try {
    const incoming = req.body;
    if (!incoming.trades || !Array.isArray(incoming.trades)) return res.status(400).json({ error: 'Invalid file' });
    const currentTrades = supabase ? (await getVal('trades') || []) : mem.trades;
    const existingIds = new Set(currentTrades.map(t => t.id));
    const newTrades = incoming.trades.filter(t => !existingIds.has(t.id));
    const merged = [...currentTrades, ...newTrades].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    if (supabase) await setVal('trades', merged); else mem.trades = merged;
    if (incoming.dailyEntries) {
      const currentDaily = supabase ? (await getVal('daily') || []) : mem.daily;
      const eid = new Set(currentDaily.map(d => d.id));
      const nd = incoming.dailyEntries.filter(d => !eid.has(d.id));
      const mergedDaily = [...currentDaily, ...nd].sort((a, b) => b.date.localeCompare(a.date));
      if (supabase) await setVal('daily', mergedDaily); else mem.daily = mergedDaily;
    }
    res.json({ success: true, newTrades: newTrades.length });
  } catch (e) {
    res.status(500).json({ error: 'Import failed' });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', db: supabase ? 'supabase' : 'memory' }));

app.listen(PORT, '0.0.0.0', () => console.log(`\n  Trading Journal running on port ${PORT}\n`));
