# GTA Alerts Backend API

Backend server that scrapes Toronto Police, Fire, and TTC data and serves it via REST API.

## Features

✅ **Toronto Fire Services** - Active incidents updated every 5 minutes  
✅ **Toronto Police Service** - Calls for service (delayed 10-15 min)  
✅ **TTC Alerts** - Transit disruptions and delays  
✅ **Automatic geocoding** - Converts addresses to map coordinates  
✅ **Smart caching** - Reduces load and improves performance  

---

## 🚀 Quick Deploy to Railway.app (Recommended - $5/month)

1. **Sign up at Railway.app**
   - Go to https://railway.app
   - Sign up with GitHub (free account)

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Connect your GitHub account
   - Select this repository

3. **Railway will auto-detect Node.js and deploy!**
   - No configuration needed
   - Gets a free domain: `your-app.railway.app`

4. **Get your API URL**
   - Copy the URL Railway gives you (e.g., `https://gta-alerts-production.up.railway.app`)
   - Test it: `https://your-url.railway.app/api/incidents`

---

## 🚀 Alternative: Deploy to Render.com ($7/month)

1. **Sign up at Render.com**
   - Go to https://render.com
   - Sign up with GitHub

2. **New Web Service**
   - Click "New +" → "Web Service"
   - Connect your GitHub repo
   - Select this folder

3. **Settings:**
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Starter ($7/month)

4. **Deploy**
   - Click "Create Web Service"
   - Wait 3-5 minutes for deployment

---

## 📡 API Endpoints

### Get all incidents
```
GET /api/incidents
```

**Response:**
```json
{
  "success": true,
  "count": 25,
  "updated": "2026-05-09T21:30:00.000Z",
  "incidents": [
    {
      "id": "F2026-12345",
      "category": "fire",
      "type": "Structure Fire",
      "description": "King St W at Bathurst, Alarm Level 2",
      "location": "King St W, Toronto, ON",
      "lat": 43.6426,
      "lon": -79.4025,
      "time": "2026-05-09T21:15:00.000Z",
      "alarmLevel": "2",
      "units": ["P313", "A333", "R334"],
      "source": "Toronto Fire Services"
    },
    ...
  ]
}
```

### Get incidents by category
```
GET /api/incidents/fire
GET /api/incidents/police
GET /api/incidents/ttc
```

### Health check
```
GET /health
```

---

## 🖥️ Local Development

### Prerequisites
- Node.js 18+ installed
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start server
npm start

# Development mode (auto-restart on changes)
npm run dev
```

Server runs at `http://localhost:3000`

---

## 🔧 Configuration

### Environment Variables

```bash
PORT=3000  # Server port (optional, defaults to 3000)
```

---

## 📝 How It Works

1. **Scrapes data every 5 minutes** from:
   - Toronto Fire: https://www.toronto.ca/.../toronto-fire-active-incidents/
   - Toronto Police: http://c4s.torontopolice.on.ca/
   - TTC: https://www.ttc.ca/service-alerts

2. **Geocodes addresses** using Nominatim (OpenStreetMap)
   - Caches coordinates for 24 hours
   - Rate-limited to respect API limits

3. **Caches results** for 5 minutes
   - Reduces server load
   - Faster API responses

4. **Serves via REST API**
   - JSON format
   - CORS enabled
   - Works with any frontend

---

## 🌐 Connect to Your Frontend

Once deployed, update your frontend HTML to fetch from your API:

```javascript
// In your gta-alerts.html
const API_URL = 'https://your-app.railway.app'; // Your deployed URL

async function fetchRealData() {
    const response = await fetch(`${API_URL}/api/incidents`);
    const data = await response.json();
    return data.incidents;
}
```

---

## 📊 Data Sources

- **Toronto Fire Services**: Official City of Toronto CAD system
- **Toronto Police Service**: Public calls for service (delayed 10-15 min)
- **TTC**: Official service alerts feed

**Note:** This app is not affiliated with TPS, TFS, TTC, or City of Toronto.

---

## 💰 Hosting Costs

| Provider | Cost | Uptime | Notes |
|----------|------|--------|-------|
| Railway | $5/mo | 99.9% | Easiest setup, auto-scaling |
| Render | $7/mo | 99.9% | Very reliable, good support |
| Fly.io | $5/mo | 99.9% | Good performance |

All include:
- Automatic SSL (HTTPS)
- Auto-restarts if crash
- Deployment from GitHub
- Logs and monitoring

---

## 🐛 Troubleshooting

### Server returns empty incidents
- Check if Toronto Police/Fire websites are accessible
- Verify scraping selectors haven't changed
- Check server logs for errors

### Geocoding fails
- Nominatim has rate limits (1 request/second)
- Server adds 100ms delay between geocoding calls
- Cached coordinates help reduce API calls

### CORS errors in frontend
- Make sure CORS is enabled in server.js (it is by default)
- Verify you're calling the correct API URL

---

## 📞 Support

If you have issues:
1. Check server logs in your hosting dashboard
2. Test endpoints directly: `https://your-url.railway.app/health`
3. Verify data sources are still accessible

---

## 📜 License

MIT - Free to use, modify, and deploy
