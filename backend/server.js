const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');

const User = require('./models/User');
const Agent = require('./models/Agent');
const AgentSnapshot = require('./models/AgentSnapshot');
const EventLog = require('./models/EventLog');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming JSON and Form Data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- DATABASE CONNECTIONS ---
// 1. Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://mongodb:27017/dawnway_db')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// 2. Connect to Redis (for Sessions)
const redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST || 'redis'}:${process.env.REDIS_PORT || 6379}`
});
redisClient.connect().catch(console.error);

// 3. Configure Sessions
app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: 'dawnway_super_secret_key', // Change this to a secure environment variable later
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS via Cloudflare
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
}));

// --- ROUTES ---

// SIGN UP ENDPOINT (Replaces PHP/signup.php)
app.post('/api/signup', async (req, res) => {
    try {
        const { username, password, password2 } = req.body;

        // Validation
        if (!username || !password || !password2) {
            return res.status(400).json({ success: false, message: "All fields are required." });
        }
        if (password !== password2) {
            return res.status(400).json({ success: false, message: "Passwords do not match." });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(409).json({ success: false, message: "Username already exists." });
        }

        // Hash the password (10 salt rounds is standard)
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create and save the new user to MongoDB
        const newUser = new User({
            username: username,
            password: hashedPassword
        });
        await newUser.save();

        // Optional: Automatically log them in by setting the session
        // req.session.user_id = newUser._id;
        // req.session.username = newUser.username;

        // Send success response (The frontend JS will handle the redirect)
        res.json({ success: true });

    } catch (error) {
        console.error("Signup error:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
});

// --- SIGN IN ENDPOINT ---
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, message: "Username or password missing!" });
        }

        // 1. Find the user
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(401).json({ success: false, message: "Username doesn't exist." });
        }

        // 2. Check the password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Incorrect password." });
        }

        // 3. Set the session variables (Redis handles storing this securely)
        req.session.userId = user._id;
        req.session.username = user.username;

        res.json({ success: true });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
});

// --- AUTH CHECK ENDPOINT ---
// The frontend will call this to see if a user is logged in
app.get('/api/me', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({ authenticated: true, username: req.session.username });
    } else {
        res.status(401).json({ authenticated: false });
    }
});

// --- LOGOUT ENDPOINT ---
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ success: false, message: "Logout failed" });
        res.clearCookie('connect.sid'); // Clears the session cookie
        res.json({ success: true });
    });
});

// --- CHARACTER CREATION ENDPOINT ---
app.post('/api/creator', async (req, res) => {
    try {
        // 1. Security Check: Are they logged in?
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ success: false, message: "Unauthorized: Please log in." });
        }

        // Destructure the incoming payload. 
        // Ensure your HTML form inputs have name="givenName", name="surname", name="gender", etc.
        const { givenName, familyName, surname, gender, age } = req.body;

        // Fallback to check either surname or familyName depending on what your HTML uses
        const finalSurname = surname || familyName;

        if (!givenName || !finalSurname) {
            return res.status(400).json({ success: false, message: "Name fields are required." });
        }

        // 2. Build the Agent 
        // We use the Agent model and explicitly map the frontend variables to your Agent.js schema
        const newAgent = new Agent({
            name: givenName,
            surname: finalSurname,
            gender: gender || 'other', // Provide a fallback to match your enum requirement
            age: age,
            user: req.session.userId 
        });

        // 3. Save to MongoDB
        await newAgent.save();

        res.json({ success: true, character: newAgent });

    } catch (error) {
        console.error("Agent creation error:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
});

// --- FETCH USER'S AGENTS ENDPOINT ---
app.get('/api/agents', async (req, res) => {
    try {
        // Security check
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        // Find all agents belonging to the session user, sorted by oldest first
        const agents = await Agent.find({ user: req.session.userId }).sort({ creation_date: 1 });
        
        res.json({ success: true, agents });
    } catch (error) {
        console.error("Error fetching agents:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// --- FETCH SINGLE AGENT, LATEST SNAPSHOT & LOGS ---
app.get('/api/agents/:id', async (req, res) => {
    try {
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const agentId = req.params.id;
        
        // 1. Fetch the Agent
        const agent = await Agent.findOne({ _id: agentId, user: req.session.userId });
        if (!agent) {
            return res.status(404).json({ success: false, message: "Agent not found" });
        }

        // 2. Fetch their latest snapshot
        const snapshot = await AgentSnapshot.findOne({ agent: agentId }).sort({ createdAt: -1 });

        // 3. Fetch their Event Logs (Newest first, limit to 50)
        const logs = await EventLog.find({ agent: agentId }).sort({ timestamp: -1 }).limit(50);

        // Bundle it all together
        res.json({ success: true, agent, snapshot, logs });
    } catch (error) {
        console.error("Error fetching agent details:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});