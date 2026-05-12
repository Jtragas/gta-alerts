const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const Parser = require('rss-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const rssParser = new Parser();

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

// Cache for breaking alerts
let cachedBreakingAlerts = [];
let lastBreakingFetch = 0;
const BREAKING_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const seenBreakingIds = new Set(); // Deduplication

// Priority keywords for breaking alerts
const HIGH_PRIORITY_KEYWORDS = [
    'escape', 'escaped', 'evacuation', 'shelter in place',
    'shooting', 'stabbing', 'homicide', 'fatal collision',
    'missing vulnerable', 'amber alert', 'lockdown',
    'explosion', 'gas leak', 'hazardous materials',
    'emergency alert', 'active shooter', 'bomb threat'
];

const MEDIUM_PRIORITY_KEYWORDS = [
    'fire', 'road closed', 'subway suspended', 'major delay',
    'police investigation', 'crash', 'collision', 'derailment',
    'service disruption', 'power outage', 'water main break'
];

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

// ========== BREAKING ALERTS SYSTEM ==========

// Priority scoring function
function calculatePriority(title, source) {
    const titleLower = title.toLowerCase();
    
    // Check for high priority keywords
    for (const keyword of HIGH_PRIORITY_KEYWORDS) {
        if (titleLower.includes(keyword)) {
            return 'high';
        }
    }
    
    // Check for medium priority keywords
    for (const keyword of MEDIUM_PRIORITY_KEYWORDS) {
        if (titleLower.includes(keyword)) {
            return 'medium';
        }
    }
    
    // Official sources get medium priority by default
    if (source === 'Toronto Police' || source === 'Toronto Fire' || source === 'TTC') {
        return 'medium';
    }
    
    return 'low';
}

// Safe fetch helper
async function safeFetch(name, fetchFn) {
    try {
        return await fetchFn();
    } catch (error) {
        console.error(`❌ ${name} breaking alerts error:`, error.message);
        return [];
    }
}

// Fetch Toronto Police RSS
async function fetchPoliceBreaking() {
    const feed = await rssParser.parseURL('https://www.tps.ca/media-centre/news-releases/?format=rss');
    return feed.items.slice(0, 5).map((item, i) => ({
        id: `tps-${item.guid || item.link || Date.now()}-${i}`,
        source: 'Toronto Police',
        type: 'official',
        priority: calculatePriority(item.title, 'Toronto Police'),
        title: item.title,
        url: item.link,
        publishedAt: item.pubDate || item.isoDate || new Date().toISOString()
    }));
}

// Fetch CBC Toronto RSS
async function fetchCBCBreaking() {
    const feed = await rssParser.parseURL('https://www.cbc.ca/cmlink/rss-topstories-toronto');
    return feed.items.slice(0, 5).map((item, i) => ({
        id: `cbc-${item.guid || item.link || Date.now()}-${i}`,
        source: 'CBC Toronto',
        type: 'news',
        priority: calculatePriority(item.title, 'CBC Toronto'),
        title: item.title,
        url: item.link,
        publishedAt: item.pubDate || item.isoDate || new Date().toISOString()
    }));
}

// Fetch CityNews Toronto RSS
async function fetchCityNewsBreaking() {
    const feed = await rssParser.parseURL('https://toronto.citynews.ca/feed/');
    return feed.items.slice(0, 5).map((item, i) => ({
        id: `citynews-${item.guid || item.link || Date.now()}-${i}`,
        source: 'CityNews Toronto',
        type: 'news',
        priority: calculatePriority(item.title, 'CityNews Toronto'),
        title: item.title,
        url: item.link,
        publishedAt: item.pubDate || item.isoDate || new Date().toISOString()
    }));
}

// Fetch Global News Toronto RSS
async function fetchGlobalNewsBreaking() {
    const feed = await rssParser.parseURL('https://globalnews.ca/toronto/feed/');
    return feed.items.slice(0, 5).map((item, i) => ({
        id: `global-${item.guid || item.link || Date.now()}-${i}`,
        source: 'Global News Toronto',
        type: 'news',
        priority: calculatePriority(item.title, 'Global News Toronto'),
        title: item.title,
        url: item.link,
        publishedAt: item.pubDate || item.isoDate || new Date().toISOString()
    }));
}

// Fetch Environment Canada weather alerts for Toronto
async function fetchWeatherAlertsBreaking() {
    try {
        const response = await axios.get('https://weather.gc.ca/rss/warning/on-143_e.xml', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000
        });
        const feed = await rssParser.parseString(response.data);
        return feed.items.slice(0, 3).map((item, i) => ({
            id: `weather-${item.guid || Date.now()}-${i}`,
            source: 'Environment Canada',
            type: 'official',
            priority: 'high', // Weather alerts are always high priority
            title: item.title,
            url: item.link,
            publishedAt: item.pubDate || item.isoDate || new Date().toISOString()
        }));
    } catch (error) {
        return [];
    }
}

// Fetch all breaking alerts
async function fetchBreakingAlerts() {
    console.log('🚨 Fetching breaking alerts...');
    
    const allAlerts = await Promise.all([
        safeFetch('Toronto Police', fetchPoliceBreaking),
        safeFetch('CBC Toronto', fetchCBCBreaking),
        safeFetch('CityNews Toronto', fetchCityNewsBreaking),
        safeFetch('Global News Toronto', fetchGlobalNewsBreaking),
        safeFetch('Weather Alerts', fetchWeatherAlertsBreaking)
    ]);
    
    // Flatten and deduplicate
    const flatAlerts = allAlerts.flat();
    const uniqueAlerts = [];
    
    for (const alert of flatAlerts) {
        if (!seenBreakingIds.has(alert.id)) {
            seenBreakingIds.add(alert.id);
            uniqueAlerts.push(alert);
        }
    }
    
    // Sort by priority (high first) and then by time (newest first)
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    uniqueAlerts.sort((a, b) => {
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        return new Date(b.publishedAt) - new Date(a.publishedAt);
    });
    
    // Keep only top 20 alerts
    const topAlerts = uniqueAlerts.slice(0, 20);
    
    console.log(`✅ Breaking alerts: ${topAlerts.length} (${topAlerts.filter(a => a.priority === 'high').length} high priority)`);
    
    cachedBreakingAlerts = topAlerts;
    lastBreakingFetch = Date.now();
    
    // Clean up old IDs (keep last 200)
    if (seenBreakingIds.size > 200) {
        const idsArray = Array.from(seenBreakingIds);
        seenBreakingIds.clear();
        idsArray.slice(-200).forEach(id => seenBreakingIds.add(id));
    }
    
    return topAlerts;
}

// Fetch all incidents
async function fetchIncidents() {
    console.log('🔄 Starting scrape...');
    
    const [fire, ttc, police] = await Promise.all([
        scrapeTorontoFire(),
        scrapeTTCAlerts(),
        scrapeTorontoPolice()
    ]);
    
    const allIncidents = [...fire, ...ttc, ...police];
    
    console.log(`✅ Total incidents: ${allIncidents.length} (Toronto only)`);
    
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

// Breaking alerts API endpoint
app.get('/api/breaking', async (req, res) => {
    try {
        const now = Date.now();
        
        if (now - lastBreakingFetch > BREAKING_CACHE_DURATION || cachedBreakingAlerts.length === 0) {
            await fetchBreakingAlerts();
        } else {
            console.log('📦 Returning cached breaking alerts');
        }
        
        res.json({
            success: true,
            count: cachedBreakingAlerts.length,
            alerts: cachedBreakingAlerts,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Breaking alerts API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch breaking alerts',
            alerts: []
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
    await fetchBreakingAlerts();
    
    // Refresh every 2 minutes (incidents) and 5 minutes (breaking alerts)
    setInterval(fetchIncidents, CACHE_DURATION);
    setInterval(fetchBreakingAlerts, BREAKING_CACHE_DURATION);
    
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`🔥 Toronto Fire XML feed: ACTIVE`);
        console.log(`🚇 TTC GTFS-Realtime feed: ACTIVE`);
        console.log(`🚔 Toronto Police ArcGIS feed: ACTIVE`);
        console.log(`🚨 Breaking GTA Alerts: ACTIVE`);
    });
}

start().catch(err => {
    console.error('❌ Server start error:', err);
    process.exit(1);
});
