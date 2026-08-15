from pathlib import Path

# Fix sentence-initial relationship phrases such as “Talked to Mika…”.
p=Path('smart-fuwa-memory.js'); s=p.read_text()
old='matchAll(/\\b(?:with|met|called|talked to|saw|visited|asked|messaged|texted|dinner with|lunch with)\\s+([A-Z][A-Za-z\'’-]+(?:\\s+[A-Z][A-Za-z\'’-]+){0,2})/g)'
new='matchAll(/\\b(?:with|met|called|talked to|saw|visited|asked|messaged|texted|dinner with|lunch with)\\s+([A-Z][A-Za-z\'’-]+(?:\\s+[A-Z][A-Za-z\'’-]+){0,2})/gi)'
assert old in s
p.write_text(s.replace(old,new,1))

# Public-facing version is Version 1.0; internal build remains v100.
p=Path('index.html'); s=p.read_text()
s=s.replace('FUWA_BUILD: v99-daily-8am-cloud-backup-qa','FUWA_BUILD: v100-version-1-remembers-qa',1)
s=s.replace('<link rel="stylesheet" href="smart-fuwa-life.css" />','<link rel="stylesheet" href="smart-fuwa-life.css" />\n  <link rel="stylesheet" href="smart-fuwa-memory.css" />',1)
s=s.replace('<script src="smart-fuwa-life.js"></script>','<script src="smart-fuwa-life.js"></script>\n  <script src="smart-fuwa-memory.js"></script>',1)
s=s.replace('What’s new in Fuwa 1.2.2','What’s new in Fuwa Version 1.0',1)
about='            <p><strong>Fuwa</strong> comes from <em>fuwafuwa (ふわふわ)</em>, meaning “soft” or “fluffy.” Fuwa is meant to feel like a soft, private place where you can put down your thoughts, memories, and feelings.</p>'
assert about in s
s=s.replace(about,about+'\n            <p class="fuwa-public-version"><strong>Version 1.0</strong> · pre-release build</p>',1)
lead='<p class="fuwa-release-lead">Fuwa can now connect the garden you’ve already grown: ask your journal, search by meaning, notice recurring threads, reflect without repetition, and look back through people, places, weeks, and older memories — all on this device.</p>'
if lead in s:s=s.replace(lead,'<p class="fuwa-release-lead">Version 1.0 now remembers more of the shape of your life: changes over time, recurring people, seasons, meaningful memories, your own vocabulary, voice journaling, Quick Dump organization, and photo-linked context — still private-first and approval-based.</p>',1)
p.write_text(s)

p=Path('app.js'); s=p.read_text(); s=s.replace('fuwa-v1.2.2-2026-08-15','fuwa-v1.0-2026-08-15',1)
anchor='  async createThread({ title, description = "", emoji = "☁️", entryIds = [] } = {}) {'
assert anchor in s
photo='''  async photoMetadata() {\n    const rows = await diaryRepository.readAllMedia();\n    return rows.map(record => ({\n      id: record.id,\n      entryId: record.entryId || null,\n      type: record.type || record.blob?.type || "image/jpeg",\n      width: Number(record.width || 0) || null,\n      height: Number(record.height || 0) || null,\n      originalName: String(record.originalName || "photo").slice(0, 120),\n      createdAt: Number(record.createdAt || 0) || null\n    }));\n  },\n'''
s=s.replace(anchor,photo+anchor,1); p.write_text(s)

p=Path('service-worker.js'); s=p.read_text(); s=s.replace('fuwa-shell-v99','fuwa-shell-v100',1).replace('fuwa-v1.2.2-2026-08-15','fuwa-v1.0-2026-08-15',1)
s=s.replace('  "./smart-fuwa-life.css",','  "./smart-fuwa-life.css",\n  "./smart-fuwa-memory.css",',1)
s=s.replace('  "./smart-fuwa-life.js",','  "./smart-fuwa-life.js",\n  "./smart-fuwa-memory.js",',1)
s=s.replace('    url.pathname.endsWith("/smart-fuwa.js") ||','    url.pathname.endsWith("/smart-fuwa.js") ||\n    url.pathname.endsWith("/smart-fuwa-life.js") ||\n    url.pathname.endsWith("/smart-fuwa-memory.js") ||\n    url.pathname.endsWith("/smart-fuwa-memory.css") ||',1)
p.write_text(s)
