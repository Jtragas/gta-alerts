// GTA Alerts Backend Server - Test Data Version
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        message: 'GTA Alerts API is running',
        timestamp: new Date().toISOString()
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'GTA Alerts API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            health: '/health',
            incidents: '/api/incidents'
        }
    });
});

// Get all incidents - TEST DATA
app.get('/api/incidents', (req, res) => {
    const testIncidents = [
        {
            id: 'test-fire-1',
            category: 'fire',
            type: 'Structure Fire',
            description: 'Structure Fire - King St W at Bathurst St',
            lat: 43.6426,
            lon: -79.4025,
            time: new Date(Date.now() - 15 * 60000).toISOString(),
            source: 'Toronto Fire Services'
        },
        {
            id: 'test-fire-2',
            category: 'fire',
            type: 'Medical Assist',
            description: 'Medical Assist - Queen St E at Broadview Ave',
            lat: 43.6686,
            lon: -79.3553,
            time: new Date(Date.now() - 8 * 60000).toISOString(),
            source: 'Toronto Fire Services'
        },
        {
            id: 'test-fire-3',
            category: 'fire',
            type: 'Alarm Response',
            description: 'Fire Alarm - Yonge St at Eglinton Ave',
            lat: 43.7076,
            lon: -79.3976,
            time: new Date(Date.now() - 22 * 60000).toISOString(),
            source: 'Toronto Fire Services'
        },
        {
            id: 'test-police-1',
            category: 'police',
            type: 'Traffic Collision',
            description: 'Multi-vehicle collision - DVP southbound at Eglinton',
            lat: 43.7056,
            lon: -79.3364,
            time: new Date(Date.now() - 32 * 60000).toISOString(),
            source: 'Toronto Police Service'
        },
        {
            id: 'test-police-2',
            category: 'police',
            type: 'Investigation',
            description: 'Police Investigation - Dundas St W at University Ave',
            lat: 43.6560,
            lon: -79.3878,
            time: new Date(Date.now() - 45 * 60000).toISOString(),
            source: 'Toronto Police Service'
        },
        {
            id: 'test-police-3',
            category: 'police',
            type: 'Disturbance',
            description: 'Public Disturbance - Yonge-Dundas Square',
            lat: 43.6561,
            lon: -79.3802,
            time: new Date(Date.now() - 12 * 60000).toISOString(),
            source: 'Toronto Police Service'
        },
        {
            id: 'test-ttc-1',
            category: 'ttc',
            type: 'Line 1 Delay',
            description: 'Signal issues causing delays between Bloor-Yonge and St. George',
            lat: 43.6708,
            lon: -79.3863,
            time: new Date(Date.now() - 18 * 60000).toISOString(),
            source: 'Toronto Transit Commission'
        },
        {
            id: 'test-ttc-2',
            category: 'ttc',
            type: 'Bus Detour',
            description: '501 Queen streetcar diverting via King St due to track work',
            lat: 43.6532,
            lon: -79.3791,
            time: new Date(Date.now() - 25 * 60000).toISOString(),
            source: 'Toronto Transit Commission'
        }
    ];
    
    res.json({
        success: true,
        count: testIncidents.length,
        updated: new Date().toISOString(),
        message: 'Test data - Real scraping coming soon',
        incidents: testIncidents
    });
});

// Get incidents by category
app.get('/api/incidents/:category', (req, res) => {
    const { category } = req.params;
    
    // Just return empty for now
    res.json({
        success: true,
        category: category,
        count: 0,
        updated: new Date().toISOString(),
        incidents: []
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ GTA Alerts API running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Incidents: http://localhost:${PORT}/api/incidents`);
    console.log(`⚠️  Using test data - real scraping coming soon`);
});
