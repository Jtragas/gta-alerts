// GTA Alerts Backend Server - Simplified Version
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());
app.use(express.json());

// Simple health check
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

// Sample incidents endpoint (we'll add real scraping after this deploys)
app.get('/api/incidents', (req, res) => {
    res.json({
        success: true,
        message: 'Backend is working! Real data scraping will be added next.',
        count: 3,
        incidents: [
            {
                id: 'test-1',
                category: 'fire',
                type: 'Structure Fire',
                description: 'Test incident - backend is running',
                lat: 43.6532,
                lon: -79.3832,
                time: new Date().toISOString()
            },
            {
                id: 'test-2',
                category: 'police',
                type: 'Traffic Stop',
                description: 'Test incident - API connected',
                lat: 43.6426,
                lon: -79.4025,
                time: new Date().toISOString()
            },
            {
                id: 'test-3',
                category: 'ttc',
                type: 'Delay',
                description: 'Test incident - deployment successful',
                lat: 43.6708,
                lon: -79.3863,
                time: new Date().toISOString()
            }
        ]
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ GTA Alerts API running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Incidents: http://localhost:${PORT}/api/incidents`);
});
