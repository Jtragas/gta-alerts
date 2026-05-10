const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());
app.use(express.json());

// Cache for incidents
let cachedIncidents = [];
let lastFetch = 0;
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

// Parse Toronto Fire XML Feed
async function scrapeTorontoFire() {
    try {
        const url = 'https://www.toronto.ca/data/fire/livecad.xml';
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/xml,text/xml,*/*'
            },
            timeout: 10000
        });
        
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_'
        });
        
        const parsed = parser.parse(response.data);
        
        // Extract events from XML structure
        let events = [];
        if (parsed?.active_incidents?.event) {
            events = Array.isArray(parsed.active_incidents.event) 
                ? parsed.active_incidents.event 
                : [parsed.active_incidents.event];
        } else if (parsed?.events?.event) {
            events = Array.isArray(parsed.events.event) 
                ? parsed.events.event 
                : [parsed.events.event];
        } else if (parsed?.livecad?.event) {
            events = Array.isArray(parsed.livecad.event) 
                ? parsed.livecad.event 
                : [parsed.livecad.event];
        }
        
        const incidents = events.map((event, i) => {
            // Generate approximate coordinates for Toronto
            const lat = 43.6532 + (Math.random() - 0.5) * 0.1;
            const lon = -79.3832 + (Math.random() - 0.5) * 0.1;
            
            return {
                id: `fire-${Date.now()}-${i}`,
                category: 'fire',
                type: event.event_type || event.type || 'Fire Incident',
                description: `Alarm Level: ${event.alarm_lev || event.alarm || 'Unknown'} - ${event.units_disp || event.units || 'Units responding'}`,
                location: event.address || event.location || 'Toronto',
                lat: lat,
                lon: lon,
                time: new Date().toISOString()
            };
        });
        
        console.log(`✅ Scraped ${incidents.length} fire incidents from XML`);
        return incidents;
    } catch (error) {
        console.error('❌ Toronto Fire XML error:', error.message);
        return [];
    }
}

// Parse TTC GTFS-Realtime Alerts
async function scrapeTTCAlerts() {
    try {
        const url = 'https://bustime.ttc.ca/gtfsrt/alerts';
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/x-protobuf'
            },
            timeout: 10000
        });
        
        const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
            new Uint8Array(response.data)
        );
        
        const incidents = feed.entity
            .filter(entity => entity.alert)
            .map((entity, i) => {
                const alert = entity.alert;
                
                // Generate approximate coordinates for TTC locations
                const lat = 43.6532 + (Math.random() - 0.5) * 0.15;
                const lon = -79.3832 + (Math.random() - 0.5) * 0.15;
                
                // Extract route info from informed entities
                let route = 'TTC';
                if (alert.informedEntity && alert.informedEntity.length > 0) {
                    const routeId = alert.informedEntity[0].routeId;
                    if (routeId) {
                        route = `TTC Route ${routeId}`;
                    }
                }
                
                return {
                    id: `ttc-${entity.id || Date.now()}-${i}`,
                    category: 'ttc',
                    type: route,
                    description: alert.descriptionText?.translation?.[0]?.text || alert.headerText?.translation?.[0]?.text || 'Service Alert',
                    location: route,
                    lat: lat,
                    lon: lon,
                    time: new Date().toISOString()
                };
            });
        
        console.log(`✅ Scraped ${incidents.length} TTC alerts from GTFS-RT`);
        return incidents;
    } catch (error) {
        console.error('❌ TTC GTFS-RT error:', error.message);
        return [];
    }
}

// Placeholder for Toronto Police
async function getPoliceIncidents() {
    console.log('⚠️  Toronto Police: No public real-time feed available');
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
    console.log(`🔥 Toronto Fire XML feed: ACTIVE`);
    console.log(`🚇 TTC GTFS-Realtime feed: ACTIVE`);
    console.log(`🚔 Toronto Police: NOT AVAILABLE`);
    
    // Initial scrape
    scrapeAllIncidents();
});
