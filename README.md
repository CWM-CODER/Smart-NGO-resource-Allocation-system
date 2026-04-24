# SmartAid – Smart Resource Allocation

**Data-Driven Volunteer Coordination Platform**

---

## 🗂 Project Structure

```
SolutonAntigravity/
├── frontend/           ← Static HTML/CSS/JS (deploy to Vercel)
│   ├── index.html          Page 1 – Problem Submission
│   ├── dashboard.html      Page 2 – AI Analysis Dashboard
│   ├── ngos.html           Page 3 – NGO Management Portal
│   ├── ngo-detail.html     Page 4 – Per-NGO Live Detail
│   ├── css/style.css       Design system (dark glassmorphism)
│   └── js/
│       ├── app.js          Shared utilities + Supabase client
│       ├── submit.js       Problem form + Google Maps picker
│       ├── dashboard.js    Analysis dashboard rendering
│       └── ngos.js         NGO portal + detail page
│
├── backend/            ← FastAPI + DL/ML engine (deploy to Render)
│   ├── main.py             API entry point
│   ├── models.py           Pydantic schemas
│   ├── supabase_client.py  DB helpers
│   ├── ml/
│   │   ├── embedder.py     MiniLM embeddings + bart-large-mnli ZSC
│   │   ├── clusterer.py    UMAP + HDBSCAN geo-semantic clustering
│   │   ├── scorer.py       Scoring formula + LightGBM ranker
│   │   └── matcher.py      Bi-encoder NGO matching + preemption LR
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
│
└── vercel.json         ← Vercel frontend config
```

---

## 🚀 Quick Setup

### 1. Supabase Database
Create a free project at [supabase.com](https://supabase.com) and run this SQL:

```sql
-- Problems
CREATE TABLE problems (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  delay_days INTEGER DEFAULT 0,
  people_affected INTEGER DEFAULT 0,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  address TEXT,
  status TEXT DEFAULT 'open',
  score DOUBLE PRECISION,
  flag BOOLEAN DEFAULT FALSE,
  verified_type TEXT,
  type_confidence DOUBLE PRECISION,
  semantic_cluster INTEGER,
  geo_cluster INTEGER,
  cluster_count INTEGER DEFAULT 0,
  assigned_ngo_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- NGOs
CREATE TABLE ngos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  address TEXT,
  total_members INTEGER DEFAULT 0,
  available_workforce INTEGER DEFAULT 0,
  work_types TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'available',
  current_problem_id UUID,
  pct_done DOUBLE PRECISION DEFAULT 0,
  eta_days DOUBLE PRECISION,
  assignment_start TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Assignments
CREATE TABLE assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ngo_id UUID REFERENCES ngos(id),
  problem_id UUID REFERENCES problems(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  pct_done_at_interrupt DOUBLE PRECISION,
  status TEXT DEFAULT 'active',
  preemption_reason TEXT
);
```

### 2. Google Maps API Key
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable: **Maps JavaScript API**, **Geocoding API**, **Distance Matrix API**, **Places API**
3. Create an API key and replace `YOUR_GOOGLE_MAPS_API_KEY` in all 4 HTML files and `backend/.env`

### 3. Backend (.env)
```bash
cp backend/.env.example backend/.env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_MAPS_API_KEY
```

### 4. Frontend Config
In each HTML file, update the `<script>` config block:
```js
window.SUPABASE_URL  = 'https://xxxx.supabase.co';
window.SUPABASE_KEY  = 'your_anon_key';
window.BACKEND_URL   = 'https://your-app.onrender.com';
window.MAPS_API_KEY  = 'your_google_maps_key';
```

---

## 🖥 Local Development

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend – just open index.html in browser (or use Live Server)
```

---

## ☁️ Free Deployment

| Layer | Platform | Cost |
|---|---|---|
| Frontend | [Vercel](https://vercel.com) | Free |
| Backend  | [Render](https://render.com) | Free |
| Database | [Supabase](https://supabase.com) | Free |
| Maps API | Google Cloud | Free up to $200/mo credit |

### Deploy Frontend (Vercel)
```bash
npm i -g vercel
cd d:\SolutonAntigravity
vercel --prod
```

### Deploy Backend (Render)
1. Push `backend/` to GitHub
2. Create a new **Web Service** on Render
3. Set **Docker** as runtime (uses the Dockerfile)
4. Add environment variables from `.env`
5. Deploy

---

## 🤖 ML Pipeline

| Step | Model | Purpose |
|---|---|---|
| Embedding | MiniLM-L6-v2 | 384-dim semantic vectors |
| Type verify | bart-large-mnli | Zero-shot type correction |
| Semantic cluster | UMAP + HDBSCAN | Group similar descriptions |
| Geo cluster | UMAP + HDBSCAN | Group by location + semantics |
| Scoring | Formula + LightGBM | Priority rank |
| Matching | Bi-encoder cosine | NGO–problem pairing |
| Preemption | Logistic Regression | Decide to interrupt current task |

---

## 📊 Scoring Formula

```
score = type_weight × 0.90
      + people_affected × 0.80
      + delay_days × 0.70
      + nearby_problems × 10
```

**Flag Rule**: Flag = True if problem appears in ≥ 2 clustering tables → top priority.
