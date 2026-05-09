// GTA Alerts Backend Server - PRODUCTION VERSION
// Scrapes REAL Toronto Police, Fire, and TTC data

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for frontend
app.use(cors());
app.use(express.json());

// Cache: 5 minutes for incidents, 24 hours for geocoding
const incidentCache = new NodeCache({ stdTTL: 300 }); // 5 minutes
const geocodeCache = new NodeCache({ stdTTL: 86400 }); // 24 hours

// Rate limiting for geocoding (max 1 request per second)
let lastGeocodeTime = 0;
const GEOCODE_DELAY = 1100; // 1.1 seconds between requests

// ============================================
// UTILITY: Rate-limited geocoding
// ============================================
async function geocodeWithRateLimit(address) {
    const now = Date.now();
    const timeSinceLastCall = now - lastGeocodeTime;
    
    if (timeSinceLastCall < GEOCODE_DELAY) {
        await new Promise(resolve => setTimeout(resolve, GEOCODE_DELAY - timeSinceLastCall));
    }
    
    lastGeocodeTime = Date.now();
    return await geocodeAddress(address);
}

// ============================================
// GEOCODING: Convert addresses to coordinates
// ============================================
async function geocodeAddress(address) {
    // Check cache first
    const cached = geocodeCache.get(address);
    if (cached) {
        console.log(`✓ Geocode cache hit: ${address}`);
        return cached;
    }
    
    try {
        console.log(`🗺️  Geocoding: ${address}`);
        
        // Using Nominatim (OpenStreetMap) - free geocoding
        const response = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
                q: address,
                format: 'json',
                limit: 1,
                countrycodes: 'ca', // Canada only
                bounded: 1,
                viewbox: '-79.639,43.581,-79.116,43.855' // Toronto bounding box
            },
            headers: {
                'User-Agent': 'GTA-Alerts/1.0 (Emergency Alert System)'
            },
            timeout: 5000
        });
        
        if (response.data && response.data.length > 0) {
            const coords = {
                lat: parseFloat(response.data[0].lat),
                lon: parseFloat(response.data[0].lon)
            };
            
            // Cache it
            geocodeCache.set(address, coords);
            console.log(`✓ Geocoded: ${address} → ${coords.lat}, ${coords.lon}`);
            return coords;
        }
        
        // Default to Toronto City Hall if geocoding fails
        console.log(`⚠️  Geocoding failed for: ${address}, using default location`);
        return { lat: 43.6532, lon: -79.3832 };
        
    } catch (error) {
        console.error(`❌ Geocoding error for ${address}:`, error.message);
        return { lat: 43.6532, lon: -79.3832 }; // Default to City Hall
    }
}

// ============================================
// TORONTO FIRE SCRAPER
// ============================================
async function scrapeTorontoFire() {
    console.log('🔥 Scraping Toronto Fire...');
    
    try {
        const response = await axios.get(
            'https://www.toronto.ca/community-people/public-safety-alerts/alerts-notifications/toronto-fire-active-incidents/',
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            }
        );
        
        const $ = cheerio.load(response.data);
        const incidents = [];
        
        // Find the incidents table
        $('table tbody tr').each((index, element) => {
            const cells = $(element).find('td');
            
            if (cells.length >= 8) {
                const primeStreet = $(cells[0]).text().trim();
                const crossStreet = $(cells[1]).text().trim();
                const dispatchTime = $(cells[2]).text().trim();
                const incidentNumber = $(cells[3]).text().trim();
                const incidentType = $(cells[4]).text().trim();
                const alarmLevel = $(cells[5]).text().trim();
                const area = $(cells[6]).text().trim();
                const units = $(cells[7]).text().trim();
                
                if (primeStreet && incidentType) {
                    const address = `${primeStreet}, Toronto, ON`;
                    
                    incidents.push({
                        id: incidentNumber || `fire-${Date.now()}-${index}`,
                        category: 'fire',
                        type: incidentType,
                        description: `${incidentType} - ${primeStreet}${crossStreet ? ' at ' + crossStreet : ''}`,
                        location: address,
                        address: primeStreet,
                        crossStreet: crossStreet,
                        time: parseFireTime(dispatchTime),
                        alarmLevel: alarmLevel,
                        area: area,
                        units: units.split(',').map(u => u.trim()).filter(u => u),
                        source: 'Toronto Fire Services',
                        needsGeocode: true
                    });
                }
            }
        });
        
        console.log(`✅ Toronto Fire: ${incidents.length} incidents`);
        return incidents;
        
    } catch (error) {
        console.error('❌ Toronto Fire scraping error:', error.message);
        return [];
    }
}

// ============================================
// TORONTO POLICE SCRAPER
// ============================================
async function scrapeTorontoPolice() {
    console.log('🚔 Scraping Toronto Police...');
    
    try {
        const response = await axios.get('http://c4s.torontopolice.on.ca/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
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
                    const address = `${location}, Toronto, ON`;
                    
                    incidents.push({
                        id: `police-${Date.now()}-${index}`,
                        category: 'police',
                        type: eventType,
                        description: `${eventType} - ${location}`,
                        location: address,
                        address: location,
                        time: parsePoliceTime(time),
                        source: 'Toronto Police Service',
                        needsGeocode: true
                    });
                }
            }
        });
        
        console.log(`✅ Toronto Police: ${incidents.length} calls`);
        return incidents;
        
    } catch (error) {
        console.error('❌ Toronto Police scraping error:', error.message);
        return [];
    }
}

// ============================================
// TTC ALERTS SCRAPER
// ============================================
async function scrapeTTCAlerts() {
    console.log('🚇 Scraping TTC Alerts...');
    
    try {
        const response = await axios.get('https://www.ttc.ca/service-alerts', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        const incidents = [];
        
        // TTC alert structure varies, so we'll be flexible
        $('.alert-item, .service-alert, [class*="alert"]').each((index, element) => {
            const title = $(element).find('.alert-title, .title, h3, h4').first().text().trim();
            const description = $(element).find('.alert-description, .description, p').first().text().trim();
            const route = $(element).find('.route, .line').first().text().trim();
            
            if (title || description) {
                incidents.push({
                    id: `ttc-${Date.now()}-${index}`,
                    category: 'ttc',
                    type: route || 'Service Alert',
                    description: title || description,
                    details: description,
                    location: 'Toronto, ON',
                    lat: 43.6532, // Default to city center for TTC
                    lon: -79.3832,
                    time: new Date().toISOString(),
                    source: 'Toronto Transit Commission',
                    needsGeocode: false // TTC alerts are city-wide
                });
            }
        });
        
        console.log(`✅ TTC: ${incidents.length} alerts`);
        return incidents;
        
    } catch (error) {
        console.error('❌ TTC scraping error:', error.message);
        return [];
    }
}

// ============================================
// TIME PARSERS
// ============================================
function parseFireTime(timeStr) {
    try {
        // Toronto Fire format: "MM/DD/YYYY HH:MM:SS"
        const [datePart, timePart] = timeStr.split(' ');
        const [month, day, year] = datePart.split('/');
        const [hours, minutes, seconds] = timePart.split(':');
        
        const date = new Date(year, month - 1, day, hours, minutes, seconds);
        return date.toISOString();
    } catch (error) {
        console.error('Time parse error:', error.message);
        return new Date().toISOString();
    }
}

function parsePoliceTime(timeStr) {
    try {
        // Police format: "HH:MM" (today assumed)
        const [hours, minutes] = timeStr.split(':');
        const date = new Date();
        date.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        return date.toISOString();
    } catch (error) {
        console.error('Time parse error:', error.message);
        return new Date().toISOString();
    }
}

// ============================================
// FETCH ALL INCIDENTS
// ============================================
async function fetchAllIncidents() {
    console.log('\n🔄 ===== FETCHING ALL INCIDENTS =====');
    const startTime = Date.now();
    
    // Scrape all sources in parallel
    const [fireIncidents, policeIncidents, ttcIncidents] = await Promise.all([
        scrapeTorontoFire(),
        scrapeTorontoPolice(),
        scrapeTTCAlerts()
    ]);
    
    // Combine all incidents
    let allIncidents = [...fireIncidents, ...policeIncidents, ...ttcIncidents];
    
    console.log(`\n📊 Total incidents before geocoding: ${allIncidents.length}`);
    console.log(`   Fire: ${fireIncidents.length}`);
    console.log(`   Police: ${policeIncidents.length}`);
    console.log(`   TTC: ${ttcIncidents.length}`);
    
    // Geocode incidents that need it
    const incidentsNeedingGeocode = allIncidents.filter(inc => inc.needsGeocode);
    console.log(`\n🗺️  Geocoding ${incidentsNeedingGeocode.length} addresses...`);
    
    for (let incident of incidentsNeedingGeocode) {
        const coords = await geocodeWithRateLimit(incident.location);
        incident.lat = coords.lat;
        incident.lon = coords.lon;
        delete incident.needsGeocode; // Clean up flag
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ ===== FETCH COMPLETE in ${duration}s =====`);
    console.log(`📍 Total incidents with coordinates: ${allIncidents.length}\n`);
    
    return allIncidents;
}

// ============================================
// API ENDPOINTS
// ============================================

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        cache: {
            incidents: incidentCache.get('incidents')?.length || 0,
            geocodes: geocodeCache.keys().length
        }
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'GTA Alerts API',
        version: '1.0.0',
        status: 'running',
        description: 'Real-time Toronto emergency alerts',
        endpoints: {
            health: '/health',
            all_incidents: '/api/incidents',
            by_category: '/api/incidents/:category'
        },
        data_sources: [
            'Toronto Fire Services',
            'Toronto Police Service',
            'Toronto Transit Commission'
        ]
    });
});

// Get all incidents
app.get('/api/incidents', async (req, res) => {
    try {
        // Check cache first
        let incidents = incidentCache.get('incidents');
        
        if (!incidents) {
            console.log('💾 Cache miss - fetching fresh data');
            incidents = await fetchAllIncidents();
            incidentCache.set('incidents', incidents);
        } else {
            console.log('⚡ Cache hit - serving cached data');
        }
        
        res.json({
            success: true,
            count: incidents.length,
            updated: new Date().toISOString(),
            cache_expires_in: incidentCache.getTtl('incidents') ? 
                Math.round((incidentCache.getTtl('incidents') - Date.now()) / 1000) : 0,
            incidents: incidents
        });
        
    } catch (error) {
        console.error('❌ API Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch incidents',
            message: error.message
        });
    }
});

// Get incidents by category
app.get('/api/incidents/:category', async (req, res) => {
    try {
        const { category } = req.params;
        
        let incidents = incidentCache.get('incidents');
        
        if (!incidents) {
            incidents = await fetchAllIncidents();
            incidentCache.set('incidents', incidents);
        }
        
        const filtered = incidents.filter(inc => inc.category === category.toLowerCase());
        
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

// ============================================
// AUTO-REFRESH
// ============================================
// Refresh data every 5 minutes
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

setInterval(async () => {
    console.log('⏰ Auto-refresh triggered');
    try {
        const incidents = await fetchAllIncidents();
        incidentCache.set('incidents', incidents);
        console.log('✅ Auto-refresh complete');
    } catch (error) {
        console.error('❌ Auto-refresh error:', error.message);
    }
}, REFRESH_INTERVAL);

// Initial fetch on startup
(async () => {
    console.log('\n🚀 ===== GTA ALERTS API STARTING =====\n');
    try {
        const incidents = await fetchAllIncidents();
        incidentCache.set('incidents', incidents);
        console.log('✅ Initial data loaded successfully\n');
    } catch (error) {
        console.error('❌ Initial data load failed:', error.message);
    }
})();

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log(`✅ GTA Alerts API running on port ${PORT}`);
    console.log(`📡 API: http://localhost:${PORT}`);
    console.log(`🔄 Auto-refresh: every ${REFRESH_INTERVAL / 1000 / 60} minutes\n`);
});
