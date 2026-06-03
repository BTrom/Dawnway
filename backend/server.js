const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');
const fs = require('fs');
const { evaluate } = require('curve-eval');
const cors = require('cors');
const path = require('path');

const User = require('./models/User');
const Agent = require('./models/Agent');
const AgentSnapshot = require('./models/AgentSnapshot');
const EventLog = require('./models/EventLog');
const Action = require('./models/Action');
const UnintentionalAction = require('./models/UnintentionalAction');
const ObjectEntry = require('./models/ObjectEntry');
const { SECONDS_PER_TICK, ruleSet } = require('./config/rules');
const { calculateTotalDiscomfort, calculateReward, updateWeights, selectAction } = require('./ai/brain');

const app = express();
const server = http.createServer(app); // NEW: Wrap Express in HTTP server
const io = new Server(server); // NEW: Attach Socket.IO
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming JSON and Form Data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
    origin: 'https://dawnway-lab.es/', // Change this to your production domain later!
    credentials: true // This is crucial: it allows the session cookies to be passed back and forth
}));

// --- DATABASE CONNECTIONS ---
// 1. Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://mongodb:27017/dawnway_db')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => logAndEmitError('MongoDB connection error:', err));

// 2. Connect to Redis (for Sessions)
const redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST || 'redis'}:${process.env.REDIS_PORT || 6379}`
});
redisClient.connect().catch(err => logAndEmitError('Redis connection error:', err));

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

const requireAuth = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next(); // The user has a valid session cookie, let them through
    }
    return res.status(401).json({ success: false, message: "Unauthorized: Please log in." });
};

const requireAdmin = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
    }
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.admin_privileges) {
            return next(); // They are logged in AND an admin, let them through
        }
        return res.status(403).json({ success: false, message: "Forbidden: Admins only." });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

// --- ROUTES ---

// SIGN UP ENDPOINT (Replaces PHP/signup.php)
app.post('/api/signup', async (req, res) => {
    try {
        const { username, email, password, password2 } = req.body;

        // Validation
        if (!username || !email || !password || !password2) {
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
            email: email,
            password: hashedPassword
        });
        await newUser.save();

        // Optional: Automatically log them in by setting the session
        // req.session.user_id = newUser._id;
        // req.session.username = newUser.username;

        // Send success response (The frontend JS will handle the redirect)
        res.json({ success: true });

    } catch (error) {
        logAndEmitError("Signup error:", error);
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
        logAndEmitError("Login error:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
});

// --- AUTH CHECK ENDPOINT ---
// The frontend will call this to see if a user is logged in
app.get('/api/me', async (req, res) => {
    if (req.session && req.session.userId) {
        try {
            // Fetch the user to check admin_privileges
            const user = await User.findById(req.session.userId);
            res.json({
                authenticated: true,
                username: req.session.username,
                admin_privileges: user ? user.admin_privileges : false,
                simPaused: simPaused,
  simTick: simTick,
  currentInterval: currentInterval
            });
        } catch (err) {
            res.status(500).json({ authenticated: false });
        }
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
app.post('/api/creator', requireAuth, async (req, res) => {
    try {
        const { givenName, familyName, surname, gender, age } = req.body;
        const finalSurname = surname || familyName;

        if (!givenName || !finalSurname) {
            return res.status(400).json({ success: false, message: "Name fields are required." });
        }
        
        // Fetch user context and count existing agents to properly evaluate the limit
        const user = await User.findById(req.session.userId);
        const currentAgentCount = await Agent.countDocuments({ user: req.session.userId });

        if (currentAgentCount >= user.character_limit) {
            return res.status(403).json({ 
                success: false, 
                message: `Character limit reached. You can only have ${user.character_limit} active agents.` 
            });
        }

        const newAgent = new Agent({
            name: givenName,
            surname: finalSurname,
            gender: gender || 'other', // Provide a fallback to match your enum requirement
            age: age,
            user: req.session.userId
        });

        await newAgent.save();
        res.json({ success: true, character: newAgent });

    } catch (error) {
        logAndEmitError("Agent creation error:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
});

// --- FETCH USER'S AGENTS ENDPOINT ---
app.get('/api/agents', async (req, res) => {
    try {
        // We're leaving this one open
        // if (!req.session || !req.session.userId) {
        //     return res.status(401).json({ success: false, message: "Unauthorized" });
        // }

        let agents;

        // Find all agents belonging to the session user, sorted by oldest first
        if (req.session && req.session.userId) {
            agents = await Agent.find({ user: req.session.userId }).sort({ creation_date: 1 });
        } else {
            agents = await Agent.find({});
        }
      
        res.json({ success: true, agents });
    } catch (error) {
        logAndEmitError("Error fetching agents:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// --- FETCH SINGLE AGENT, LATEST SNAPSHOT & LOGS ---
app.get('/api/agents/:id', async (req, res) => {
    try {
        // if (!req.session || !req.session.userId) {
        //     return res.status(401).json({ success: false, message: "Unauthorized" });
        // }

        const agentId = req.params.id;
        // const agent = await Agent.findOne({ _id: agentId, user: req.session.userId });
        const agent = await Agent.findById(agentId);

        if (!agent) {
            return res.status(404).json({ success: false, message: "Agent not found" });
        }

        let snapshot = await AgentSnapshot.findOne({ agent: agentId }).sort({ timestamp: -1 });
        const logs = await EventLog.find({ agent: agentId }).sort({ timestamp: -1 }).limit(50);

        const ramState = liveAgents.get(agentId);
        if (ramState && snapshot) {
            snapshot = snapshot.toObject(); // Convert from Mongoose doc to standard object
            snapshot.needs = ramState.needs;
            snapshot.emotions = ramState.emotions;
        }

        const urgencies = {};
        const priorities = {};
        const finalNeeds = snapshot ? (snapshot.needs.toObject ? snapshot.needs.toObject() : snapshot.needs) : {};

        // Grab the tick from the snapshot to keep history accurate, fallback to global simTick
        const currentTick = snapshot ? (parseInt(snapshot.tick) || 0) : simTick;
        const circMult = getCircadianMultiplier(currentTick);
       
        for (const [key, val] of Object.entries(finalNeeds)) {
            urgencies[key] = getUrgencyForNeed(key, val);
            let currentPriority = (ruleSet.needs[key] && ruleSet.needs[key].priority !== undefined) ? ruleSet.needs[key].priority : 1;
            if (key === 'sleep') currentPriority = currentPriority * circMult;
            priorities[key] = currentPriority;
        }
       
        res.json({ success: true, agent, snapshot, logs, urgencies, priorities });
       
    } catch (error) {
        logAndEmitError("Error fetching agent details:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// --- BULK CHARACTER CREATION (API REQUIREMENT) ---
app.post('/api/agents/bulk', requireAdmin, async (req, res) => {
    try {
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const amount = parseInt(req.body.amount) || 100;

        let bulkUser = await User.findOne({ username: 'system_bulk_tester' });
        if (!bulkUser) {
            // Generate an impossible password so no one can ever log into this account
            const hashed = await bcrypt.hash(Date.now().toString() + Math.random(), 10);
            bulkUser = new User({ username: 'system_bulk_tester', password: hashed });
            await bulkUser.save();
        }

        // 1. Fetch from the External API 
        // We only request the fields we need to keep the payload lightweight
        const apiUrl = `https://randomuser.me/api/?results=${amount}&inc=name,gender,dob`;
        const apiResponse = await fetch(apiUrl);
        const apiData = await apiResponse.json();

        // 2. Map the external data to your Agent schema
        const newAgentsData = apiData.results.map(user => {
            return {
                // user: req.session.userId, // We can use this for having the agents visible immediately
                user: bulkUser._id,
                name: user.name.first,
                surname: user.name.last,
                gender: user.gender, // randomuser returns 'male'/'female', fitting your enum perfectly
                age: user.dob.age,
                is_bulk_created: true
            };
        });

        // 3. Bulk insert into MongoDB (Extremely fast compared to looping .save())
        const insertedAgents = await Agent.insertMany(newAgentsData);

        // 4. Inject them directly into RAM so the sim picks them up instantly
        const snapshotsToInsert = insertedAgents.map(agent => ({
            agent: agent._id,
            tick: simTick,
            needs: { hunger: 100, thirst: 100, bladder: 100, hygiene: 100, sleep: 100, health: 100 },
            emotions: { joy: 50, sadness: 0, anger: 0, fear: 0 }
        }));

        // 5. Bulk insert Snapshots
        const insertedSnapshots = await AgentSnapshot.insertMany(snapshotsToInsert);

        // 6. Inject them directly into RAM
        for (const snap of insertedSnapshots) {
            liveAgents.set(snap.agent.toString(), {
                needs: snap.needs,
                emotions: snap.emotions,
                current_action: null,
                busy_until: 0,
                current_action_obj: null,
                current_action_per_tick: null,
                lfa_weights: {},
                last_action_urgencies: {},
                last_action_id: null,
                discomfort_at_start: 0,
                action_duration_ticks: 1
            });
        }

        // Emit an event so the frontend knows to refresh the character list
        io.emit('bulk_agents_added');

        res.json({
            success: true,
            message: `Successfully fetched and injected ${amount} agents.`,
            count: insertedAgents.length
        });

    } catch (error) {
        logAndEmitError("Bulk creation error:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
});

// --- BULK CHARACTER CLEANUP ---
app.delete('/api/agents/bulk', requireAdmin, async (req, res) => {
    try {
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        // 1. Find all bulk agents tied to this user
        const bulkAgents = await Agent.find({ user: req.session.userId, is_bulk_created: true });
        const bulkAgentIds = bulkAgents.map(a => a._id);

        if (bulkAgentIds.length === 0) {
             return res.json({ success: true, message: "No bulk agents found to delete." });
        }

        // 2. Remove them from the hot RAM state so the tick loop ignores them
        for (const id of bulkAgentIds) {
            liveAgents.delete(id.toString());
        }

        // 3. Purge them from the database
        await AgentSnapshot.deleteMany({ agent: { $in: bulkAgentIds } });
        await EventLog.deleteMany({ agent: { $in: bulkAgentIds } });
        const deleteResult = await Agent.deleteMany({ _id: { $in: bulkAgentIds } });

        io.emit('bulk_agents_removed');

        res.json({ success: true, message: `Purged ${deleteResult.deletedCount} test agents and their history.` });
    } catch (error) {
        logAndEmitError("Bulk deletion error:", error);
        res.status(500).json({ success: false, message: "Internal server error during cleanup." });
    }
});

// --- SIMULATION CONTROL ENDPOINTS (ADMIN) ---
// Note: In production, you'd wrap this in an auth check to ensure only YOU can trigger it!

app.post('/api/sim/control', requireAdmin, async (req, res) => {
    // Make sure you have an auth check here in production!
    const { action, value } = req.body;

    try {
        if (action === 'pause') {
            simPaused = true;
            await redisClient.set('sim:paused', 'true');
            return res.json({ success: true, simTick, simPaused });

        } else if (action === 'resume') {
            simPaused = false;
            await redisClient.set('sim:paused', 'false');
            return res.json({ success: true, simTick, simPaused });

        } else if (action === 'set_tick') {
            simTick = parseInt(value) || 0;
            await redisClient.set('sim:tick', simTick);
            io.emit('sim_update', { tick: simTick });
            return res.json({ success: true, simTick, simPaused });

        } else if (action === 'set_speed') {
            const newSpeed = parseInt(value) || 1000;
            startSimulation(newSpeed);
            return res.json({ success: true, currentInterval: newSpeed });

        }else if (action === 'fast_forward') {
            const ticksToRun = parseInt(value) || 10000;
            const wasPaused = simPaused;
            simPaused = true;

            fastForwardSim(ticksToRun, res);
            simPaused = wasPaused;
            // Return immediately so we don't hit any other res.json below!
            return;

        } else {
            return res.status(400).json({ success: false, message: "Invalid action" });
        }

        res.json({ success: true, simTick, simPaused, currentInterval });
    } catch (error) {
        logAndEmitError("Sim control route error:", error);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, message: "Sim control failed" });
        }
    }
});

app.get('/api/sim/control/script', requireAdmin, (req, res) => {
    // Assuming admin-tools.js is in the same directory as server.js
    res.sendFile(path.join(__dirname, 'admin-tools.js')); 
});

app.get('/api/config', requireAuth, (req, res) => {
    res.json({
        success: true,
        SECONDS_PER_TICK: SECONDS_PER_TICK
    });
});

io.on('connection', (socket) => {
    // When a user logs in and the frontend sees they are an admin,
    // it will emit this event to subscribe to real-time server errors.
    socket.on('join_admin_room', () => {
        socket.join('admins');
        logAndEmitError(`Admin joined debugging room: ${socket.id}`);
    });
});

// --- NEW: CENTRALIZED ERROR LOGGER ---
function logAndEmitError(contextMessage, errorObj = null) {
    // 1. Still log to the terminal so you have a permanent record
    console.error(`[ERROR] ${contextMessage}`, errorObj || '');

    // 2. Emit only to sockets in the 'admins' room
    io.to('admins').emit('admin_server_error', {
        context: contextMessage,
        details: errorObj ? (errorObj.message || errorObj.toString()) : 'No additional details'
    });
}



// --- NEED MECHANICS CALCULATION ---
function calculateNeed(needName, currentValue, currentHp) {
    // 1. Get the thresholds array for this specific need
    const rules = ruleSet.needs[needName].thresholds;

    // Default to the very last bracket (0) just in case
    let activeBracket = rules[rules.length - 1];

    for (const rule of rules) {
        if (currentValue >= rule.threshold) {
            activeBracket = rule;
            break;
        }
    }

    // 3. Apply the decay and ensure values don't drop below 0
    // Using Math.max to prevent negative numbers
    let newValue = Math.max(0, currentValue + activeBracket.rate);
    // Rounding to 2 decimal places to prevent floating-point long numbers (e.g., 89.9999999)
    // User: We can't use only two decimals because the smallest need change in a tick is 0.0031666(...), so if we round, we get no change at all. We need to find the sweet spot between bloating and not losing data
    newValue = Math.round(newValue * 100000) / 100000;

    let newHp = currentHp;
    if (activeBracket.hpDecay != 0) {
        newHp = Math.max(0, currentHp + activeBracket.hpDecay);
        newHp = Math.round(newHp * 100000) / 100000;
    }

    return { newValue, newHp };
}

// --- LUT (Look-Up Table) FOR NEED CURVES ---
// This will store arrays of exactly 101 values (0 to 100) for instant lookups
const bakedUrgencyLUT = {};
const bakedCircadianLUT = [];

function bakeCurvesToRAM() {
    console.log("Baking need curves into memory...");
    try {
        // 1. Read and parse the JSON file generated by the Curve Editor
        // (Make sure the path matches where you put needs.curve.json)
        const rawCurveData = fs.readFileSync('./config/needs.curve.json', 'utf8');
        const curveFile = JSON.parse(rawCurveData);

        const needNames = ['hunger', 'thirst', 'bladder', 'sleep', 'hygiene'];

        // 2. Loop through each need and build an array of 101 values
        needNames.forEach(need => {
            bakedUrgencyLUT[need] = [];
            
            // X-axis is 0 to 100 (representing the agent's current need level)
            for (let i = 0; i <= 100; i++) {
                // The curve time in the editor goes from 0.0 to 1.0,
                // so we normalize our 0-100 value by dividing by 100.
                const time = i / 100;
                
                // Evaluate the curve at this exact frame
                let urgency = evaluate(curveFile, need, time);
                
                // Clean up the floating point math (round to 4 decimals)
                urgency = Math.round(urgency * 10000) / 10000;
                
                // Push to our LUT
                bakedUrgencyLUT[need].push(urgency);
            }
        });

        for (let i = 0; i <= 144; i++) {
            const time = i / 6;
            let value = evaluate(curveFile, "circadian", time);
            value = Math.round(value * 1000) / 1000;
            bakedCircadianLUT.push(value);
        }

        console.log("Curves baked successfully!");
        
        // 3. Print the 'hunger' array to verify it looks correct
        console.log("--- Baked Hunger LUT ---");
        console.dir(bakedUrgencyLUT["hunger"], {'maxArrayLength': null});
        console.log("------------------------");

    } catch (err) {
        logAndEmitError("Failed to bake curves. Is the file path correct?", err);
    }
}

// Execute the baker immediately
bakeCurvesToRAM();

// --- URGENCY HELPER ---
function getUrgencyForNeed(needName, value) {
    // Fallback to 0 for needs that aren't in the LUT (like 'health')
    if (!bakedUrgencyLUT[needName]) return 0;
    
    // Calculate the array index. Since index 0 is 100%, and index 100 is 0%:
    const index = 100 - Math.round(value);
    
    // Clamp the index between 0 and 100 just to be safe
    const safeIndex = Math.max(0, Math.min(100, index));
    
    return bakedUrgencyLUT[needName][safeIndex] || 0;
}

function getCircadianMultiplier(currentSimTick) {
    // Use modulo to wrap the total game ticks into the current 24-hour cycle
    const timeOfDayIndex = currentSimTick % 144;
    
    // Return the multiplier, fallback to 1.0 if something breaks
    return bakedCircadianLUT[timeOfDayIndex] || 1.0;
}

// --- THE GAME LOOP (SIMULATION TICK) ---

let simTick = 0;
let simPaused = true; // Let's start paused by default so it doesn't run away from you!

// 1. Load the last known state from Redis on startup
async function loadSimState() {
    const savedTick = await redisClient.get('sim:tick');
    const savedPause = await redisClient.get('sim:paused');
    
    if (savedTick) simTick = parseInt(savedTick);
    // If the database says it was running, unpause. Otherwise keep paused.
    if (savedPause === 'false') simPaused = false;
    
    console.log(`Sim State Loaded -> Tick: ${simTick} | Paused: ${simPaused}`);
}
loadSimState();

// --- SIMULATION TIME CALCULATOR ---
function formatSimulationTime(tick) {
    tick = parseInt(tick) || 0;
    const totalMinutes = tick * (SECONDS_PER_TICK / 60);
    const minutes = totalMinutes % 60;
    const totalHours = Math.floor(totalMinutes / 60);
    const hours = totalHours % 24;

    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');

    return `${hh}:${mm}`;
}

// --- IN-MEMORY GAME STATE ---
const liveAgents = new Map(); // Stores the hot data for every agent
let actionsCache = []; // Stores all actions in RAM

// Load all agents into RAM on startup
async function initializeSimulationState() {
    console.log("Loading game state into memory...");
    try {
        // 1. Load all actions and populate their related ObjectEntry
        // We explicitly tell Mongoose to use the 'ObjectEntry' model in case the ref in Action.js is wrong
        actionsCache = await Action.find({}).populate({ path: 'object', model: 'ObjectEntry' });
        console.log(`Loaded ${actionsCache.length} actions into RAM.`);

        // 2. Load all agents
        for (const [agentId, state] of liveAgents.entries()) {
            let snap = await AgentSnapshot.findOne({ agent: agent._id }).sort({ timestamp: -1 });
            
            // Your brilliant initialization block for new agents!
            if (!snap) {
                console.log(`Initializing new snapshot for Agent ${agent.name}...`);
                snap = new AgentSnapshot({
                    agent: agent._id,
                    tick: simTick,
                    needs: { hunger: 100, thirst: 100, bladder: 100, hygiene: 100, sleep: 100, health: 100 },
                    emotions: { joy: 50, sadness: 0, anger: 0, fear: 0 }
                });
                await snap.save();
            }

            // Store purely the mutable data in RAM
            liveAgents.set(agent._id.toString(), {
                needs: snap.needs.toObject ? snap.needs.toObject() : snap.needs,
                emotions: snap.emotions.toObject ? snap.emotions.toObject() : snap.emotions,
                current_action: snap.current_action,
                busy_until: 0, // Tracks what tick the agent becomes free
                current_action_obj: null, // Holds the full action data while busy
                current_action_per_tick: null, // Stores the divided fraction
                // --- AI TRACKING VARIABLES ---
                lfa_weights: snap.lfa_weights ? Object.fromEntries(snap.lfa_weights) : {},
                last_action_urgencies: {}, // To store how they felt before the action
                last_action_id: null, // To know which weights to update
                discomfort_at_start: 0,
                action_duration_ticks: 1
            });
        }
        console.log(`Successfully loaded ${liveAgents.size} agents into RAM.`);
    } catch (err) {
        logAndEmitError("Failed to initialize game state:", err);
    }
}

// Call this right after loadSimState()
initializeSimulationState();



// 2. The Core Tick Interval
let simTimerId = null;
let currentInterval = 1000; // Milliseconds

// --- CORE TICK LOGIC (Used by Real-Time & Fast-Forward) ---
function processAgentTick(agentId, state, currentTick) {
    let needsChanged = false;
    let actionChanged = false;

    // --- 1. APPLY PASSIVE DECAY ---
    const needNames = ['hunger', 'thirst', 'bladder', 'hygiene', 'sleep'];
    for (const need of needNames) {
        const result = calculateNeed(need, state.needs[need] || 100, state.needs.health);
        if (result.newValue !== state.needs[need] || result.newHp !== state.needs.health) {
            state.needs[need] = result.newValue;
            state.needs.health = result.newHp;
            needsChanged = true;
        }
    }

    // --- Helper to get live urgencies for AI decisions ---
    const currentUrgencies = {};
    const currentPriorities = {};
    const circMult = getCircadianMultiplier(currentTick);

    for (const [key, val] of Object.entries(state.needs)) {
        currentUrgencies[key] = getUrgencyForNeed(key, val);
        let p = (ruleSet.needs[key] && ruleSet.needs[key].priority !== undefined) ? ruleSet.needs[key].priority : 1;
        if (key === 'sleep') p = p * circMult;
        currentPriorities[key] = p;
    }

    // --- 2. ACTION LOGIC (Phase A: Learning) ---
    if (currentTick === state.busy_until && state.last_action_id) {
        const discomfortAfter = calculateTotalDiscomfort(currentUrgencies, currentPriorities);
        const reward = calculateReward(state.discomfort_at_start, discomfortAfter, state.action_duration_ticks);
        
        state.lfa_weights = updateWeights(
            state.lfa_weights,
            state.last_action_id,
            state.last_action_urgencies,
            reward
        );
    }

    // Apply the active effects of the current action while it runs
    if (state.current_action_obj && state.current_action_per_tick && currentTick <= state.busy_until) {
        const e = state.current_action_per_tick;
        for (const need of needNames) {
            state.needs[need] = Math.max(0, Math.min(100, state.needs[need] + (e[need] || 0)));
        }
        state.needs.health = Math.max(0, Math.min(100, state.needs.health + (e.health || 0)));
        needsChanged = true;
    }

    // --- 3. ACTION LOGIC (Phase B: Decision) ---
    if (currentTick >= state.busy_until && actionsCache.length > 0) {
        // Capture the "Before" State for the next learning phase
        state.discomfort_at_start = calculateTotalDiscomfort(currentUrgencies, currentPriorities);
        state.last_action_urgencies = { ...currentUrgencies };
        
        // AI Decision (Epsilon-Greedy)
        const chosenAction = selectAction(actionsCache, currentUrgencies, state.lfa_weights);
        
        state.current_action = chosenAction._id;
        state.current_action_obj = chosenAction;
        state.last_action_id = chosenAction._id.toString();

        const ticksNeeded = Math.max(1, Math.ceil(chosenAction.duration / 10));
        state.busy_until = currentTick + ticksNeeded;
        state.action_duration_ticks = ticksNeeded;
        actionChanged = true;

        // Calculate Per-Tick Effect
        const effect = chosenAction.needs_effect || {};
        state.current_action_per_tick = {};
        for (const need of [...needNames, 'health']) {
            state.current_action_per_tick[need] = (effect[need] || 0) / ticksNeeded;
        }

        // Only log to DB if we are NOT fast-forwarding (checked by caller)
    }

    return { needsChanged, actionChanged };
}

async function tickLoop() {
    if (simPaused) return;

    simTick++;
    redisClient.set('sim:tick', simTick);
    io.emit('sim_update', { tick: simTick });

    try {
        for (const [agentId, state] of liveAgents.entries()) {
            
            // Pass the state to our new helper
            const { needsChanged, actionChanged } = processAgentTick(agentId, state, simTick);

            // --- REAL-TIME EVENT LOGGING ---
            if (actionChanged && state.current_action_obj) {
                const timeString = formatSimulationTime(simTick);
                const objectName = state.current_action_obj.object ? state.current_action_obj.object.name : "Unknown Object";
                let logString = `${state.current_action_obj.name} ${objectName} at ${timeString}`;
                
                const newLog = new EventLog({
                    agent: agentId,
                    event_category: 'action',
                    description: logString.charAt(0).toUpperCase() + logString.slice(1),
                    action: state.current_action_obj._id
                });
                newLog.save().then(savedLog => io.emit('new_event_log', savedLog)).catch(err => logAndEmitError('Error saving event log:', err));
            }

            // --- REAL-TIME FRONTEND EMIT ---
            if (needsChanged || actionChanged) {
                const urgencies = {};
                for (const [key, val] of Object.entries(state.needs)) {
                    urgencies[key] = getUrgencyForNeed(key, val);
                }
                io.emit('agent_update', {
                    agentId: agentId,
                    needs: state.needs,
                    urgencies: urgencies,
                    emotions: state.emotions
                });
            }

            // --- SAVE TO MONGODB ---
            if (needsChanged || actionChanged) {
                const newSnapshot = new AgentSnapshot({
                    agent: agentId,
                    tick: simTick,
                    needs: state.needs,
                    emotions: state.emotions,
                    current_action: state.current_action,
                    lfa_weights: state.lfa_weights // Save the brain!
                });
                newSnapshot.save().catch(err => logAndEmitError('Error saving agent snapshot:', err));
            }
        }
    } catch (error) {
        logAndEmitError("Tick Processing Error:", error);
    }
}

// --- HEADLESS FAST-FORWARD (TRAINING LOOP) ---
function fastForwardSim(ticksToRun, res) {
    const targetTick = simTick + ticksToRun;
    const chunkSize = 500; // Process 500 ticks before yielding to event loop
    
    // Save "Before" Snapshot for all agents
    for (const [agentId, state] of liveAgents.entries()) {
        new AgentSnapshot({
            agent: agentId, tick: simTick, needs: state.needs, emotions: state.emotions, lfa_weights: state.lfa_weights
        }).save().catch(err => logAndEmitError('Error saving agent snapshot:', err));
    }

    function processChunk() {
        let ticksProcessedThisChunk = 0;

        while (simTick < targetTick && ticksProcessedThisChunk < chunkSize) {
            simTick++;
            ticksProcessedThisChunk++;

            // Run the core logic ONLY. No DB saves, no socket emits.
            for (const [agentId, state] of liveAgents.entries()) {
                processAgentTick(agentId, state, simTick);
            }
        }

        if (simTick < targetTick) {
            // Yield to the event loop so the server doesn't freeze
            setImmediate(processChunk);
        } else {
            // Done! Save "After" Snapshot and finalize.
            redisClient.set('sim:tick', simTick);
            
            for (const [agentId, state] of liveAgents.entries()) {
                new AgentSnapshot({
                    agent: agentId, tick: simTick, needs: state.needs, emotions: state.emotions, lfa_weights: state.lfa_weights
                }).save().catch(err => logAndEmitError('Error saving agent snapshot:', err));
                
                // Blast final state to the UI
                io.emit('agent_update', { agentId: agentId, needs: state.needs, emotions: state.emotions });
            }
            
            io.emit('sim_update', { tick: simTick });
            console.log(`Fast-forward complete. Reached tick ${simTick}`);
            
            // Send response back to the admin who triggered it
            res.json({ success: true, message: `Fast-forwarded ${ticksToRun} ticks.`, newTick: simTick });
        }
    }

    // Start the first chunk
    processChunk();
}

function startSimulation(interval) {
    if (simTimerId) {
        clearInterval(simTimerId); // Destroy the old timer
    }
    currentInterval = interval;
    simTimerId = setInterval(tickLoop, currentInterval); // Start the new one
}

startSimulation(currentInterval);

// --- START SERVER ---
// Change from app.listen to server.listen!
server.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});