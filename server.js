const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());
app.use(express.json());

// Cache for incidents
let cachedIncidents = [];
let lastFetch = 0;
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

// Scrape Toronto Fire Active Incidents
async function scrapeTorontoFire() {
    try {
        const url = 'https://www.toronto.ca/community-people/public-safety-alerts/alerts-notifications/toronto-fire-active-incidents/';
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Cache-Control': 'max-age=0'
            },
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        const incidents = [];
        
        // Parse the table rows
        $('table tbody tr').each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 4) {
                const address = $(cols[0]).text().trim();
                const incidentType = $(cols[1]).text().trim();
                const alarmLevel = $(cols[2]).text().trim();
                const units = $(cols[3]).text().trim();
                
                if (address && incidentType) {
                    // Generate approximate coordinates for Toronto addresses
                    // In production, you'd use a geocoding API
                    const lat = 43.6532 + (Math.random() - 0.5) * 0.1;
                    const lon = -79.3832 + (Math.random() - 0.5) * 0.1;
                    
                    incidents.push({
                        id: `fire-${Date.now()}-${i}`,
                        category: 'fire',
                        type: incidentType,
                        description: `${alarmLevel} - ${units} units responding`,
                        location: address,
                        lat: lat,
                        lon: lon,
                        time: new Date().toISOString()
                    });
                }
            }
        });
        
        console.log(`✅ Scraped ${incidents.length} fire incidents`);
        return incidents;
    } catch (error) {
        console.error('❌ Toronto Fire scraper error:', error.message);
        return [];
    }
}

// Scrape TTC Service Alerts
async function scrapeTTCAlerts() {
    try {
        // TTC has an unofficial API endpoint
        const url = 'https://www.ttc.ca/Service_Advisories/all_service_alerts.jsp';
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Referer': 'https://www.ttc.ca/',
                'Cache-Control': 'max-age=0'
            },
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        const incidents = [];
        
        // Parse service alerts
        $('.alert-box').each((i, alert) => {
            const route = $(alert).find('.route-name').text().trim();
            const description = $(alert).find('.alert-description').text().trim();
            
            if (route && description) {
                // TTC incidents get approximate subway station coordinates
                const lat = 43.6532 + (Math.random() - 0.5) * 0.15;
                const lon = -79.3832 + (Math.random() - 0.5) * 0.15;
                
                incidents.push({
                    id: `ttc-${Date.now()}-${i}`,
                    category: 'ttc',
                    type: route,
                    description: description,
                    location: `TTC ${route}`,
                    lat: lat,
                    lon: lon,
                    time: new Date().toISOString()
                });
            }
        });
        
        console.log(`✅ Scraped ${incidents.length} TTC alerts`);
        return incidents;
    } catch (error) {
        console.error('❌ TTC scraper error:', error.message);
        return [];
    }
}

// Placeholder for Toronto Police (blocked by 403)
async function getPoliceIncidents() {
    // Toronto Police CAD is blocked - we'll add sample data for now
    // In production, you'd need to find an alternative data source
    console.log('⚠️  Toronto Police scraper: Finding alternative data source...');
    return [];
}

// Main scraper function
async function scrapeAllIncidents() {
    console.log('🔄 Starting scrape...');
    
    const [fireIncidents, ttcIncidents, policeIncidents] = await Promise.all([
        scrapeTorontoFire(),
        scrapeTTCAlerts(),
        getPoliceIncidents()
    ]);
    
    const allIncidents = [
        ...fireIncidents,
        ...ttcIncidents,
        ...policeIncidents
    ];
    
    console.log(`✅ Total incidents: ${allIncidents.length}`);
    return allIncidents;
}

// API endpoint
app.get('/api/incidents', async (req, res) => {
    try {
        const now = Date.now();
        
        // Use cache if fresh
        if (cachedIncidents.length > 0 && (now - lastFetch) < CACHE_DURATION) {
            console.log('📦 Returning cached incidents');
            return res.json({
                success: true,
                message: 'Live data from cache',
                count: cachedIncidents.length,
                incidents: cachedIncidents,
                cached: true
            });
        }
        
        // Scrape fresh data
        const incidents = await scrapeAllIncidents();
        
        // Update cache
        cachedIncidents = incidents;
        lastFetch = now;
        
        res.json({
            success: true,
            message: 'Live data scraped',
            count: incidents.length,
            incidents: incidents,
            cached: false
        });
    } catch (error) {
        console.error('❌ API error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching incidents',
            error: error.message
        });
    }
});

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'GTA Alerts API',
        endpoints: ['/api/incidents']
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔥 Toronto Fire scraper: ACTIVE`);
    console.log(`🚇 TTC alerts scraper: ACTIVE`);
    console.log(`🚔 Toronto Police scraper: PENDING (403 blocked)`);
    
    // Initial scrape
    scrapeAllIncidents();
});
