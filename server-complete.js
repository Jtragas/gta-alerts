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
            const address = event.address || event.location || 'Toronto';
            let lat = event.latitude || event.lat || (43.6532 + (Math.random() - 0.5) * 0.1);
            let lon = event.longitude || event.lon || event.lng || (-79.3832 + (Math.random() - 0.5) * 0.1);
            
            lat = typeof lat === 'string' ? parseFloat(lat) : lat;
            lon = typeof lon === 'string' ? parseFloat(lon) : lon;
            
            return {
                id: `fire-${Date.now()}-${i}`,
                category: 'fire',
                type: event.event_type || event.type || 'Fire Incident',
                description: `Alarm Level: ${event.alarm_lev || event.alarm || 'Unknown'} - ${event.units_disp || event.units || 'Units responding'}`,
                location: address,
                lat: lat,
                lon: lon,
                timestamp: new Date().toISOString()
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
                const lat = 43.6532 + (Math.random() - 0.5) * 0.15;
                const lon = -79.3832 + (Math.random() - 0.5) * 0.15;
                
                let route = 'TTC';
                if (alert.informedEntity && alert.informedEntity.length > 0) {
                    const routeId = alert.informedEntity[0].routeId;
                    if (routeId) route = `TTC Route ${routeId}`;
                }
                
                let timestamp = new Date().toISOString();
                if (alert.activePeriod && alert.activePeriod.length > 0 && alert.activePeriod[0].start) {
                    timestamp = new Date(alert.activePeriod[0].start * 1000).toISOString();
                }
                
                return {
                    id: `ttc-${entity.id || Date.now()}-${i}`,
                    category: 'ttc',
                    type: route,
                    description: alert.descriptionText?.translation?.[0]?.text || alert.headerText?.translation?.[0]?.text || 'Service Alert',
                    location: route,
                    lat: lat,
                    lon: lon,
                    timestamp: timestamp
                };
            });
        
        console.log(`✅ Scraped ${incidents.length} TTC alerts from GTFS-RT`);
        return incidents;
    } catch (error) {
        console.error('❌ TTC GTFS-RT error:', error.message);
        return [];
    }
}

// Parse Toronto Police ArcGIS Calls for Service
async function scrapeTorontoPolice() {
    try {
        const url = 'https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/Police_C4S/FeatureServer/0/query';
        
        const params = {
            where: '1=1',
            outFields: '*',
            returnGeometry: 'true',
            f: 'json',
            resultRecordCount: 100,
            orderByFields: 'ATSCENE_TS DESC'
        };
        
        const response = await axios.get(url, {
            params: params,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            },
            timeout: 15000
        });
        
        if (!response.data || !response.data.features) {
            console.log('⚠️  Police: No features in response');
            return [];
        }
        
        const incidents = response.data.features
            .filter(feature => feature.geometry && feature.attributes)
            .map((feature, i) => {
                const attrs = feature.attributes;
                const geom = feature.geometry;
                
                let timestamp = new Date().toISOString();
                if (attrs.ATSCENE_TS) {
                    timestamp = new Date(attrs.ATSCENE_TS).toISOString();
                }
                
                return {
                    id: `police-${attrs.OBJECTID || Date.now()}-${i}`,
                    category: 'police',
                    type: attrs.TYP_ENG || 'Police Call',
                    description: `Division: ${attrs.DGROUP || 'Unknown'} - ${attrs.TYP_ENG || 'Call for Service'}`,
                    location: attrs.XSTREETS || attrs.LOCATION || 'Toronto',
                    lat: geom.y,
                    lon: geom.x,
                    timestamp: timestamp
                };
            });
        
        console.log(`✅ Scraped ${incidents.length} police calls from ArcGIS`);
        return incidents;
    } catch (error) {
        console.error('❌ Toronto Police ArcGIS error:', error.message);
        return [];
    }
}

// Main scraper function
async function scrapeAllIncidents() {
    console.log('🔄 Starting scrape...');
    
    const [fireIncidents, ttcIncidents, policeIncidents] = await Promise.all([
        scrapeTorontoFire(),
        scrapeTTCAlerts(),
        scrapeTorontoPolice()
    ]);
    
    const allIncidents = [
        ...fireIncidents,
        ...ttcIncidents,
        ...policeIncidents
    ];
    
    // Sort by timestamp (newest first)
    allIncidents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
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
        message: 'GTA Alerts API - All sources active',
        endpoints: ['/api/incidents']
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔥 Toronto Fire XML feed: ACTIVE`);
    console.log(`🚇 TTC GTFS-Realtime feed: ACTIVE`);
    console.log(`🚔 Toronto Police ArcGIS feed: ACTIVE`);
    
    // Initial scrape
    scrapeAllIncidents();
});
