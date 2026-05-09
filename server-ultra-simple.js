const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/', (req, res) => {
    res.json({ name: 'GTA Alerts API', status: 'running' });
});

app.get('/api/incidents', (req, res) => {
    res.json({
        success: true,
        count: 8,
        incidents: [
            { id: '1', category: 'fire', type: 'Structure Fire', description: 'Fire at King St W', lat: 43.6426, lon: -79.4025, time: new Date().toISOString(), source: 'Toronto Fire' },
            { id: '2', category: 'fire', type: 'Medical', description: 'Medical at Queen St E', lat: 43.6686, lon: -79.3553, time: new Date().toISOString(), source: 'Toronto Fire' },
            { id: '3', category: 'fire', type: 'Alarm', description: 'Alarm at Yonge St', lat: 43.7076, lon: -79.3976, time: new Date().toISOString(), source: 'Toronto Fire' },
            { id: '4', category: 'police', type: 'Collision', description: 'Collision on DVP', lat: 43.7056, lon: -79.3364, time: new Date().toISOString(), source: 'Toronto Police' },
            { id: '5', category: 'police', type: 'Investigation', description: 'Investigation at Dundas St W', lat: 43.6560, lon: -79.3878, time: new Date().toISOString(), source: 'Toronto Police' },
            { id: '6', category: 'police', type: 'Disturbance', description: 'Disturbance at Yonge-Dundas', lat: 43.6561, lon: -79.3802, time: new Date().toISOString(), source: 'Toronto Police' },
            { id: '7', category: 'ttc', type: 'Delay', description: 'Line 1 delays', lat: 43.6708, lon: -79.3863, time: new Date().toISOString(), source: 'TTC' },
            { id: '8', category: 'ttc', type: 'Detour', description: '501 Queen detour', lat: 43.6532, lon: -79.3791, time: new Date().toISOString(), source: 'TTC' }
        ]
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));
