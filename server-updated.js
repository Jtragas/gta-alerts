const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

const app = express();
const PORT = process.env.PORT || 3000;

// Helper function to convert to Toronto timezone
function toTorontoTime(dateInput) {
    let date;
    if (typeof dateInput === 'string') {
        // Parse string dates (from Fire feed like "2026-05-10 09:35:18")
        // Assume these are already in Toronto time
        date = new Date(dateInput + ' GMT-0400'); // EDT offset
    } else {
        // Unix timestamp in milliseconds (from Police feed)
        date = new Date(dateInput);
    }
    return date.toISOString();
}

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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/xml,text/xml,*/*',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            responseType: 'text',
            timeout: 30000,
            validateStatus: () => true
        });
        
        if (response.status !== 200) {
            console.error('❌ Toronto Fire HTTP error:', response.status);
            return [];
        }
        
        const parser = new XMLParser({
            ignoreAttributes: false,
            trimValues: true
        });
        
        const parsed = parser.parse(response.data);
        
        // Extract events from correct XML structure
        const root = parsed?.tfs_active_incidents;
        const rawEvents = root?.event || [];
        const events = Array.isArray(rawEvents) ? rawEvents : rawEvents ? [rawEvents] : [];
        
        const incidents = events.map((event, i) => {
            // Build location string
            const location = [event.prime_street, event.cross_streets]
                .filter(Boolean)
                .join(' / ');
            
            // Determine category - fire vs medical
            const eventType = (event.event_type || '').toUpperCase();
            const category = eventType.includes('MEDICAL') ? 'ems' : 'fire';
            
            // Generate approximate coordinates for Toronto
            // TODO: Add geocoding service for accurate coordinates
            const lat = 43.6532 + (Math.random() - 0.5) * 0.1;
            const lon = -79.3832 + (Math.random() - 0.5) * 0.1;
            
            // Parse timestamp
            let timestamp = new Date().toISOString();
            if (event.dispatch_time) {
                try {
                    timestamp = toTorontoTime(event.dispatch_time);
                } catch (e) {
                    // Use current time if parse fails
                }
            }
            
            return {
                id: `${category}-${event.event_num || Date.now()}-${i}`,
                category: category,
                type: event.event_type || (category === 'fire' ? 'Fire Incident' : 'Medical Emergency'),
                description: `Alarm Level ${event.alarm_lev || 'Unknown'} - ${event.units_disp || 'Units responding'}`,
                location: location || 'Toronto',
                lat: lat,
                lon: lon,
                timestamp: timestamp
            };
        });
        
        console.log(`✅ Scraped ${incidents.length} fire/ems incidents from XML`);
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
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*'
            },
            responseType: 'arraybuffer',
            timeout: 30000,
            validateStatus: () => true
        });
        
        if (response.status !== 200) {
            console.error('❌ TTC HTTP error:', response.status);
            return [];
        }
        
        const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(response.data));
        const alerts = feed.entity || [];
        
        const incidents = alerts
            .filter(entity => entity.alert)
            .map((entity, i) => {
                const alert = entity.alert;
                const headerText = alert.headerText?.translation?.[0]?.text || 'TTC Alert';
                const descriptionText = alert.descriptionText?.translation?.[0]?.text || '';
                
                const routeMatch = headerText.match(/Route\s+(\d+)/i) || 
                                  headerText.match(/Line\s+(\d+)/i) ||
                                  descriptionText.match(/Route\s+(\d+)/i);
                
                const routeNum = routeMatch ? routeMatch[1] : '';
                const location = routeNum ? `TTC Route ${routeNum}` : 'TTC Toronto';
                
                const lat = 43.6532 + (Math.random() - 0.5) * 0.1;
                const lon = -79.3832 + (Math.random() - 0.5) * 0.1;
                
                return {
                    id: `ttc-${entity.id || Date.now()}-${i}`,
                    category: 'ttc',
                    type: headerText,
                    description: descriptionText,
                    location: location,
                    lat: lat,
                    lon: lon,
                    timestamp: new Date().toISOString()
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
        const url = 'https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/C4S_Public_NoGO/FeatureServer/0/query';
        
        const params = {
            where: '1=1',
            outFields: '*',
            returnGeometry: 'true',
            returnZ: 'true',
            f: 'json',
            resultRecordCount: '100',
            orderByFields: 'OCCURRENCE_TIME_AGOL DESC, OBJECTID ASC'
        };
        
        const response = await axios.get(url, {
            params,
            paramsSerializer: {
                serialize: (params) => {
                    const search = new URLSearchParams();
                    for (const [key, value] of Object.entries(params)) {
                        search.append(key, value);
                    }
                    return search.toString();
                }
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json,text/plain,*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://experience.arcgis.com/',
                'Origin': 'https://experience.arcgis.com',
                'Connection': 'keep-alive'
            },
            responseType: 'json',
            decompress: true,
            timeout: 30000,
            validateStatus: () => true
        });
        
        // Check for ArcGIS errors
        if (response.data?.error) {
            console.error('❌ ArcGIS error:', response.data.error);
            return [];
        }
        
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
                if (attrs.OCCURRENCE_TIME_AGOL) {
                    timestamp = toTorontoTime(attrs.OCCURRENCE_TIME_AGOL);
                }
                
                // Get call type
                const callType = attrs.CALL_TYPE || attrs.EVENT_TYPE || 'Police Call';
                
                // Get location (cross streets)
                const location = attrs.CROSS_STREETS || attrs.XSTREETS || 'Toronto';
                
                // Get division
                const division = attrs.DIVISION || '';
                
                return {
                    id: `police-${attrs.OBJECTID || Date.now()}-${i}`,
                    category: 'police',
                    type: callType,
                    description: callType,
                    location: location,
                    lat: geom.y || 43.6532,
                    lon: geom.x || -79.3832,
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

// ========== NYC FEEDS ==========

// Parse NYC FDNY Fire Incidents
async function scrapeNYCFire() {
    try {
        const url = 'https://data.cityofnewyork.us/resource/8m42-w767.json';
        const response = await axios.get(url, {
            params: {
                '$limit': 100,
                '$order': 'incident_datetime DESC'
            },
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            },
            timeout: 15000
        });
        
        const incidents = (response.data || []).map((item, i) => {
            return {
                id: `nyc-fire-${item.starfire_incident_id || Date.now()}-${i}`,
                category: 'fire',
                type: item.incident_type_desc || 'Fire Incident',
                description: item.incident_type_desc || 'Fire Incident',
                location: `${item.street_highway || 'NYC'}, ${item.incident_borough || 'New York'}`,
                lat: parseFloat(item.latitude_public) || 40.7128,
                lon: parseFloat(item.longitude_public) || -74.0060,
                timestamp: item.incident_datetime || new Date().toISOString(),
                city: 'NYC',
                delayed: true
            };
        });
        
        console.log(`✅ Scraped ${incidents.length} NYC FDNY incidents`);
        return incidents;
    } catch (error) {
        console.error('❌ NYC FDNY error:', error.message);
        return [];
    }
}

// Parse NYC NYPD Calls for Service
async function scrapeNYCPolice() {
    try {
        const url = 'https://data.cityofnewyork.us/resource/n2zq-pubd.json';
        const response = await axios.get(url, {
            params: {
                '$limit': 100,
                '$order': 'create_date DESC'
            },
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            },
            timeout: 15000
        });
        
        const incidents = (response.data || []).map((item, i) => {
            return {
                id: `nyc-police-${item.cad_incident_id || Date.now()}-${i}`,
                category: 'police',
                type: item.call_type || 'Police Call',
                description: item.call_type || 'Police Call',
                location: `${item.incident_address || 'NYC'}, ${item.incident_borough || 'New York'}`,
                lat: parseFloat(item.latitude) || 40.7128,
                lon: parseFloat(item.longitude) || -74.0060,
                timestamp: item.create_date || new Date().toISOString(),
                city: 'NYC',
                delayed: true
            };
        });
        
        console.log(`✅ Scraped ${incidents.length} NYC NYPD calls`);
        return incidents;
    } catch (error) {
        console.error('❌ NYC NYPD error:', error.message);
        return [];
    }
}

// Parse NYC MTA Subway Alerts (GTFS-Realtime)
async function scrapeNYCMTA() {
    try {
        // MTA uses multiple feeds, using alerts feed for service changes
        const url = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts';
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': '*/*'
            },
            responseType: 'arraybuffer',
            timeout: 15000,
            validateStatus: () => true
        });
        
        if (response.status !== 200) {
            console.error('❌ NYC MTA HTTP error:', response.status);
            return [];
        }
        
        const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(response.data));
        const alerts = feed.entity || [];
        
        const incidents = alerts
            .filter(entity => entity.alert)
            .map((entity, i) => {
                const alert = entity.alert;
                const headerText = alert.headerText?.translation?.[0]?.text || 'MTA Alert';
                const descriptionText = alert.descriptionText?.translation?.[0]?.text || '';
                
                // Extract route/line info
                const routeMatch = headerText.match(/\[([A-Z0-9]+)\]/i) || 
                                  headerText.match(/Line ([A-Z0-9]+)/i) ||
                                  headerText.match(/([A-Z0-9]) train/i);
                
                const routeNum = routeMatch ? routeMatch[1] : '';
                const location = routeNum ? `MTA ${routeNum} Line` : 'NYC Subway';
                
                // Generate approximate NYC subway coordinates (Times Square area as default)
                const lat = 40.7580 + (Math.random() - 0.5) * 0.1;
                const lon = -73.9855 + (Math.random() - 0.5) * 0.1;
                
                return {
                    id: `nyc-mta-${entity.id || Date.now()}-${i}`,
                    category: 'ttc', // Using same category as TTC for transit
                    type: headerText,
                    description: descriptionText,
                    location: location,
                    lat: lat,
                    lon: lon,
                    timestamp: new Date().toISOString(),
                    city: 'NYC',
                    delayed: false // MTA alerts are real-time
                };
            });
        
        console.log(`✅ Scraped ${incidents.length} NYC MTA alerts from GTFS-RT`);
        return incidents;
    } catch (error) {
        console.error('❌ NYC MTA error:', error.message);
        return [];
    }
}

// Parse NYC DOT Traffic Incidents
async function scrapeNYCTraffic() {
    try {
        const url = 'https://data.cityofnewyork.us/resource/qiz3-axqb.json';
        const response = await axios.get(url, {
            params: {
                '$limit': 100,
                '$order': 'created_date DESC'
            },
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            },
            timeout: 15000
        });
        
        const incidents = (response.data || []).map((item, i) => {
            return {
                id: `nyc-traffic-${item.unique_key || Date.now()}-${i}`,
                category: 'police', // Using police category for traffic/road incidents
                type: item.descriptor || 'Traffic Incident',
                description: `${item.descriptor || 'Traffic Incident'} - ${item.status || 'Active'}`,
                location: `${item.intersection_street_1 || 'NYC'}, ${item.borough || 'New York'}`,
                lat: parseFloat(item.latitude) || 40.7128,
                lon: parseFloat(item.longitude) || -74.0060,
                timestamp: item.created_date || new Date().toISOString(),
                city: 'NYC',
                delayed: false // DOT incidents are relatively real-time
            };
        });
        
        console.log(`✅ Scraped ${incidents.length} NYC DOT traffic incidents`);
        return incidents;
    } catch (error) {
        console.error('❌ NYC DOT traffic error:', error.message);
        return [];
    }
}

// Fetch all incidents
async function fetchIncidents() {
    console.log('🔄 Starting scrape...');
    
    const [fire, ttc, police, nycFire, nycPolice, nycMTA, nycTraffic] = await Promise.all([
        scrapeTorontoFire(),
        scrapeTTCAlerts(),
        scrapeTorontoPolice(),
        scrapeNYCFire(),
        scrapeNYCPolice(),
        scrapeNYCMTA(),
        scrapeNYCTraffic()
    ]);
    
    const allIncidents = [...fire, ...ttc, ...police, ...nycFire, ...nycPolice, ...nycMTA, ...nycTraffic];
    
    console.log(`✅ Total incidents: ${allIncidents.length} (Toronto: ${fire.length + ttc.length + police.length}, NYC: ${nycFire.length + nycPolice.length + nycMTA.length + nycTraffic.length})`);
    
    cachedIncidents = allIncidents;
    lastFetch = Date.now();
    
    return allIncidents;
}

// API endpoint
app.get('/api/all', async (req, res) => {
    try {
        const now = Date.now();
        
        if (now - lastFetch > CACHE_DURATION || cachedIncidents.length === 0) {
            await fetchIncidents();
        } else {
            console.log('📦 Returning cached incidents');
        }
        
        res.json({
            success: true,
            count: cachedIncidents.length,
            incidents: cachedIncidents,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch incidents',
            incidents: []
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
async function start() {
    // Initial fetch
    await fetchIncidents();
    
    // Refresh every 2 minutes
    setInterval(fetchIncidents, CACHE_DURATION);
    
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`🔥 Toronto Fire XML feed: ACTIVE`);
        console.log(`🚇 TTC GTFS-Realtime feed: ACTIVE`);
        console.log(`🚔 Toronto Police ArcGIS feed: ACTIVE`);
        console.log(`🗽 NYC FDNY Open Data feed: ACTIVE`);
        console.log(`🗽 NYC NYPD Open Data feed: ACTIVE`);
        console.log(`🚇 NYC MTA GTFS-Realtime feed: ACTIVE`);
        console.log(`🚗 NYC DOT Traffic feed: ACTIVE`);
    });
}

start().catch(err => {
    console.error('❌ Server start error:', err);
    process.exit(1);
});
