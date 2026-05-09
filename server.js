// GTA Alerts Backend Server
// Scrapes Toronto Police, Fire, TTC, Weather data and serves via API

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const NodeCache = require('node-cache');

const app = express();
const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

// Enable CORS for your frontend
app.use(cors());
app.use(express.json());

// Geocoding cache to avoid repeated API calls
const geocodeCache = new NodeCache({ stdTTL: 86400 }); // 24 hour cache

// ============================================
// TORONTO FIRE SCRAPER
// ============================================
async function scrapeTorontoFire() {
    try {
        const response = await axios.get('https://www.toronto.ca/community-people/public-safety-alerts/alerts-notifications/toronto-fire-active-incidents/');
        const $ = cheerio.load(response.data);
        
        const incidents = [];
        
        // Find the table with incidents
        $('table tbody tr').each((index, element) => {
            const cells = $(element).find('td');
            
            if (cells.length >= 6) {
                const primeStreet = $(cells[0]).text().trim();
                const crossStreet = $(cells[1]).text().trim();
                const dispatchTime = $(cells[2]).text().trim();
                const incidentNumber = $(cells[3]).text().trim();
                const incidentType = $(cells[4]).text().trim();
                const alarmLevel = $(cells[5]).text().trim();
                const area = $(cells[6]).text().trim();
                const units = $(cells[7]).text().trim();
                
                if (primeStreet && incidentType) {
                    incidents.push({
                        id: incidentNumber || `fire-${Date.now()}-${index}`,
                        category: 'fire',
                        type: incidentType,
                        description: `${primeStreet}${crossStreet ? ' at ' + crossStreet : ''}, Alarm Level ${alarmLevel}`,
                        location: `${primeStreet}, Toronto, ON`,
                        address: primeStreet,
                        crossStreet: crossStreet,
                        time: parseFireTime(dispatchTime),
                        alarmLevel: alarmLevel,
                        area: area,
                        units: units.split(',').map(u => u.trim()),
                        source: 'Toronto Fire Services'
                    });
                }
            }
        });
        
        console.log(`✅ Scraped ${incidents.length} Toronto Fire incidents`);
        return incidents;
        
    } catch (error) {
        console.error('❌ Error scraping Toronto Fire:', error.message);
        return [];
    }
}

// ============================================
// TORONTO POLICE SCRAPER
// ============================================
async function scrapeTorontoPolice() {
    try {
        const response = await axios.get('http://c4s.torontopolice.on.ca/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        const incidents = [];
        
        // Parse the police calls table
        $('table tr').each((index, element) => {
            if (index === 0) return; // Skip header
            
            const cells = $(element).find('td');
            
            if (cells.length >= 3) {
                const time = $(cells[0]).text().trim();
                const eventType = $(cells[1]).text().trim();
                const location = $(cells[2]).text().trim();
                
                if (eventType && location) {
                    incidents.push({
                        id: `police-${Date.now()}-${index}`,
                        category: 'police',
                        type: eventType,
                        description: `${eventType} - ${location}`,
                        location: `${location}, Toronto, ON`,
                        address: location,
                        time: parsePoliceTime(time),
                        source: 'Toronto Police Service'
                    });
                }
            }
        });
        
        console.log(`✅ Scraped ${incidents.length} Toronto Police calls`);
        return incidents;
        
    } catch (error) {
        console.error('❌ Error scraping Toronto Police:', error.message);
        return [];
    }
}

// ============================================
// TTC ALERTS SCRAPER
// ============================================
async function scrapeTTCAlerts() {
    try {
        const response = await axios.get('https://www.ttc.ca/service-alerts');
        const $ = cheerio.load(response.data);
        
        const incidents = [];
        
        $('.service-alert').each((index, element) => {
            const title = $(element).find('.alert-title').text().trim();
            const description = $(element).find('.alert-description').text().trim();
            const route = $(element).find('.route').text().trim();
            
            if (title) {
                incidents.push({
                    id: `ttc-${Date.now()}-${index}`,
                    category: 'ttc',
                    type: route || 'Service Alert',
                    description: title + (description ? ': ' + description : ''),
                    location: 'Toronto, ON', // TTC is city-wide
                    lat: 43.6532,
                    lon: -79.3832,
                    time: new Date(),
                    source: 'Toronto Transit Commission'
                });
            }
        });
        
        console.log(`✅ Scraped ${incidents.length} TTC alerts`);
        return incidents;
        
    } catch (error) {
        console.error('❌ Error scraping TTC:', error.message);
        return [];
    }
}

// ============================================
// GEOCODING (Convert addresses to coordinates)
// ============================================
async function geocodeAddress(address) {
    // Check cache first
    const cached = geocodeCache.get(address);
    if (cached) return cached;
    
    try {
        // Using Nominatim (OpenStreetMap) - free geocoding
        const response = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
                q: address,
                format: 'json',
                limit: 1
            },
            headers: {
                'User-Agent': 'GTA-Alerts/1.0'
            }
        });
        
        if (response.data && response.data.length > 0) {
            const coords = {
                lat: parseFloat(response.data[0].lat),
                lon: parseFloat(response.data[0].lon)
            };
            
            // Cache it
            geocodeCache.set(address, coords);
            return coords;
        }
        
        // Default to Toronto City Hall if geocoding fails
        return { lat: 43.6532, lon: -79.3832 };
        
    } catch (error) {
        console.error(`❌ Geocoding error for ${address}:`, error.message);
        return { lat: 43.6532, lon: -79.3832 };
    }
}

// ============================================
// TIME PARSERS
// ============================================
function parseFireTime(timeStr) {
    // Toronto Fire uses format like "05/09/2026 14:35:22"
    try {
        const date = new Date(timeStr);
        return date.toISOString();
    } catch {
        return new Date().toISOString();
    }
}

function parsePoliceTime(timeStr) {
    // Police uses format like "14:35" (today's date assumed)
    try {
        const [hours, minutes] = timeStr.split(':');
        const date = new Date();
        date.setHours(parseInt(hours), parseInt(minutes), 0);
        return date.toISOString();
    } catch {
        return new Date().toISOString();
    }
}

// ============================================
// FETCH ALL DATA
// ============================================
async function fetchAllIncidents() {
    console.log('🔄 Fetching all incidents...');
    
    const [fireIncidents, policeIncidents, ttcIncidents] = await Promise.all([
        scrapeTorontoFire(),
        scrapeTorontoPolice(),
        scrapeTTCAlerts()
    ]);
    
    // Combine all incidents
    let allIncidents = [...fireIncidents, ...policeIncidents, ...ttcIncidents];
    
    // Geocode addresses for incidents that don't have coordinates
    console.log('🗺️  Geocoding addresses...');
    for (let incident of allIncidents) {
        if (!incident.lat || !incident.lon) {
            const coords = await geocodeAddress(incident.location);
            incident.lat = coords.lat;
            incident.lon = coords.lon;
            
            // Small delay to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    console.log(`✅ Total incidents: ${allIncidents.length}`);
    return allIncidents;
}

// ============================================
// API ENDPOINTS
// ============================================

// Get all incidents
app.get('/api/incidents', async (req, res) => {
    try {
        // Check cache first
        let incidents = cache.get('incidents');
        
        if (!incidents) {
            incidents = await fetchAllIncidents();
            cache.set('incidents', incidents);
        }
        
        res.json({
            success: true,
            count: incidents.length,
            updated: new Date().toISOString(),
            incidents: incidents
        });
        
    } catch (error) {
        console.error('❌ API Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get incidents by category
app.get('/api/incidents/:category', async (req, res) => {
    try {
        const { category } = req.params;
        let incidents = cache.get('incidents');
        
        if (!incidents) {
            incidents = await fetchAllIncidents();
            cache.set('incidents', incidents);
        }
        
        const filtered = incidents.filter(inc => inc.category === category);
        
        res.json({
            success: true,
            category: category,
            count: filtered.length,
            updated: new Date().toISOString(),
            incidents: filtered
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'GTA Alerts API',
        version: '1.0.0',
        endpoints: {
            all_incidents: '/api/incidents',
            by_category: '/api/incidents/:category',
            health: '/health'
        }
    });
});

// ============================================
// AUTO-REFRESH DATA
// ============================================
// Refresh data every 5 minutes
setInterval(async () => {
    console.log('⏰ Auto-refresh triggered');
    const incidents = await fetchAllIncidents();
    cache.set('incidents', incidents);
}, 5 * 60 * 1000); // 5 minutes

// Initial fetch on startup
(async () => {
    console.log('🚀 Starting GTA Alerts API...');
    const incidents = await fetchAllIncidents();
    cache.set('incidents', incidents);
    console.log('✅ Initial data loaded');
})();

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ GTA Alerts API running on port ${PORT}`);
    console.log(`📡 Access at: http://localhost:${PORT}`);
});
