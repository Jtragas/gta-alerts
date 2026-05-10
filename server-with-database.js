const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database
async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS incidents (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                category TEXT NOT NULL,
                type TEXT NOT NULL,
                description TEXT,
                location TEXT,
                lat REAL,
                lon REAL,
                timestamp TIMESTAMPTZ NOT NULL,
                division TEXT,
                raw_data JSONB,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            
            CREATE INDEX IF NOT EXISTS idx_incidents_timestamp ON incidents(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_incidents_source ON incidents(source);
            CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents(category);
            CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at DESC);
        `);
        console.log('✅ Database initialized');
    } catch (error) {
        console.error('❌ Database init error:', error.message);
    }
}

// Helper function to convert to Toronto timezone
function toTorontoTime(dateInput) {
    let date;
    if (typeof dateInput === 'string') {
        date = new Date(dateInput + ' GMT-0400'); // EDT offset
    } else {
        date = new Date(dateInput);
    }
    return date.toISOString();
}

// Save incident to database (avoid duplicates)
async function saveIncident(incident) {
    try {
        await pool.query(`
            INSERT INTO incidents (id, source, category, type, description, location, lat, lon, timestamp, division, raw_data)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (id) DO UPDATE SET
                description = EXCLUDED.description,
                location = EXCLUDED.location,
                timestamp = EXCLUDED.timestamp
        `, [
            incident.id,
            incident.source || incident.category,
            incident.category,
            incident.type,
            incident.description,
            incident.location,
            incident.lat,
            incident.lon,
            incident.timestamp,
            incident.division || null,
            JSON.stringify(incident)
        ]);
    } catch (error) {
        console.error('❌ Save incident error:', error.message);
    }
}

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
        const root = parsed?.tfs_active_incidents;
        const rawEvents = root?.event || [];
        const events = Array.isArray(rawEvents) ? rawEvents : rawEvents ? [rawEvents] : [];
        
        const incidents = events.map((event, i) => {
            const location = [event.prime_street, event.cross_streets]
                .filter(Boolean)
                .join(' / ');
            
            const eventType = (event.event_type || '').toUpperCase();
            const category = eventType.includes('MEDICAL') ? 'ems' : 'fire';
            
            const lat = 43.6532 + (Math.random() - 0.5) * 0.1;
            const lon = -79.3832 + (Math.random() - 0.5) * 0.1;
            
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
                source: category,
                category: category,
                type: event.event_type || (category === 'fire' ? 'Fire Incident' : 'Medical Emergency'),
                description: `Alarm Level ${event.alarm_lev || 'Unknown'} - ${event.units_disp || 'Units responding'}`,
                location: location || 'Toronto',
                lat: lat,
                lon: lon,
                timestamp: timestamp,
                division: event.beat || null
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
                    source: 'ttc',
                    category: 'ttc',
                    type: headerText,
                    description: descriptionText,
                    location: location,
                    lat: lat,
                    lon: lon,
                    timestamp: new Date().toISOString(),
                    division: routeNum ? `Route ${routeNum}` : null
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
                
                const callType = attrs.CALL_TYPE || attrs.EVENT_TYPE || 'Police Call';
                const location = attrs.CROSS_STREETS || attrs.XSTREETS || 'Toronto';
                const division = attrs.DIVISION || '';
                
                return {
                    id: `police-${attrs.OBJECTID || Date.now()}-${i}`,
                    source: 'police',
                    category: 'police',
                    type: callType,
                    description: callType,
                    location: location,
                    lat: geom.y || 43.6532,
                    lon: geom.x || -79.3832,
                    timestamp: timestamp,
                    division: division
                };
            });
        
        console.log(`✅ Scraped ${incidents.length} police calls from ArcGIS`);
        return incidents;
    } catch (error) {
        console.error('❌ Toronto Police ArcGIS error:', error.message);
        return [];
    }
}

// Fetch all incidents and save to database
async function fetchAndSaveIncidents() {
    console.log('🔄 Starting scrape...');
    
    const [fire, ttc, police] = await Promise.all([
        scrapeTorontoFire(),
        scrapeTTCAlerts(),
        scrapeTorontoPolice()
    ]);
    
    const allIncidents = [...fire, ...ttc, ...police];
    
    // Save to database
    for (const incident of allIncidents) {
        await saveIncident(incident);
    }
    
    console.log(`✅ Total incidents: ${allIncidents.length}`);
    
    cachedIncidents = allIncidents;
    lastFetch = Date.now();
    
    return allIncidents;
}

// API endpoint for live incidents
app.get('/api/all', async (req, res) => {
    try {
        const now = Date.now();
        
        if (now - lastFetch > CACHE_DURATION || cachedIncidents.length === 0) {
            await fetchAndSaveIncidents();
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

// API endpoint for statistics
app.get('/api/stats', async (req, res) => {
    try {
        const { period = '24h' } = req.query;
        
        // Calculate time ranges
        const now = new Date();
        const ranges = {
            '24h': new Date(now - 24 * 60 * 60 * 1000),
            '7d': new Date(now - 7 * 24 * 60 * 60 * 1000),
            '30d': new Date(now - 30 * 24 * 60 * 60 * 1000)
        };
        
        const since = ranges[period] || ranges['24h'];
        
        // Get total counts
        const totalResult = await pool.query(
            'SELECT COUNT(*) as total FROM incidents WHERE timestamp >= $1',
            [since]
        );
        
        // Get counts by source
        const bySourceResult = await pool.query(
            'SELECT source, COUNT(*) as count FROM incidents WHERE timestamp >= $1 GROUP BY source',
            [since]
        );
        
        // Get counts by type (top 15)
        const byTypeResult = await pool.query(
            'SELECT type, COUNT(*) as count FROM incidents WHERE timestamp >= $1 GROUP BY type ORDER BY count DESC LIMIT 15',
            [since]
        );
        
        // Get counts by division (top 15)
        const byDivisionResult = await pool.query(
            'SELECT division, COUNT(*) as count FROM incidents WHERE timestamp >= $1 AND division IS NOT NULL GROUP BY division ORDER BY count DESC LIMIT 15',
            [since]
        );
        
        // Get hourly counts for last 24 hours
        const hourlyResult = await pool.query(`
            SELECT 
                DATE_TRUNC('hour', timestamp) as hour,
                COUNT(*) as count
            FROM incidents 
            WHERE timestamp >= $1
            GROUP BY hour
            ORDER BY hour
        `, [new Date(now - 24 * 60 * 60 * 1000)]);
        
        // Format response
        const bySource = {};
        bySourceResult.rows.forEach(row => {
            bySource[row.source] = parseInt(row.count);
        });
        
        const byType = {};
        byTypeResult.rows.forEach(row => {
            byType[row.type] = parseInt(row.count);
        });
        
        const byDivision = {};
        byDivisionResult.rows.forEach(row => {
            byDivision[row.division] = parseInt(row.count);
        });
        
        const hourly = hourlyResult.rows.map(row => ({
            hour: row.hour,
            count: parseInt(row.count)
        }));
        
        res.json({
            success: true,
            period: period,
            since: since,
            total: parseInt(totalResult.rows[0].total),
            bySource: bySource,
            byType: byType,
            byDivision: byDivision,
            hourly: hourly
        });
    } catch (error) {
        console.error('❌ Stats API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch statistics'
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize and start server
async function start() {
    await initDatabase();
    
    // Initial fetch
    await fetchAndSaveIncidents();
    
    // Refresh every 2 minutes
    setInterval(fetchAndSaveIncidents, CACHE_DURATION);
    
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`🔥 Toronto Fire XML feed: ACTIVE`);
        console.log(`🚇 TTC GTFS-Realtime feed: ACTIVE`);
        console.log(`🚔 Toronto Police ArcGIS feed: ACTIVE`);
    });
}

start().catch(err => {
    console.error('❌ Server start error:', err);
    process.exit(1);
});
