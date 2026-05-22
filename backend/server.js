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

const User = require('./models/User');
const Agent = require('./models/Agent');
const AgentSnapshot = require('./models/AgentSnapshot');
const EventLog = require('./models/EventLog');
const Action = require('./models/Action');
const UnintentionalAction = require('./models/UnintentionalAction');
const ObjectEntry = require('./models/ObjectEntry');
const { SECONDS_PER_TICK, ruleSet } = require('./config/rules');

const app = express();
const server = http.createServer(app); // NEW: Wrap Express in HTTP server
const io = new Server(server); // NEW: Attach Socket.IO
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
        const agent = await Agent.findOne({ _id: agentId, user: req.session.userId });

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
        
        res.json({ success: true, agent, snapshot, logs });
        
    } catch (error) {
        console.error("Error fetching agent details:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// --- SIMULATION CONTROL ENDPOINTS (ADMIN) ---
// Note: In production, you'd wrap this in an auth check to ensure only YOU can trigger it!

app.post('/api/sim/control', async (req, res) => {
    const { action, value } = req.body;

    try {
        if (action === 'pause') {
            simPaused = true;
            await redisClient.set('sim:paused', 'true');
        } 
        else if (action === 'resume') {
            simPaused = false;
            await redisClient.set('sim:paused', 'false');
        } 
        else if (action === 'set_tick') {
            simTick = parseInt(value) || 0;
            await redisClient.set('sim:tick', simTick);
            // Force an immediate UI update even if paused
            io.emit('sim_update', { tick: simTick }); 
        }
        else {
            return res.status(400).json({ success: false, message: "Invalid action" });
        }

        res.json({ success: true, simTick, simPaused });
    } catch (error) {
        res.status(500).json({ success: false, message: "Sim control failed" });
    }
});

// --- LUT (Look-Up Table) FOR NEED CURVES ---
// This will store arrays of exactly 101 values (0 to 100) for instant lookups
const bakedUrgencyLUT = {}; 

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

        console.log("Curves baked successfully!");
        
        // 3. Print the 'hunger' array to verify it looks correct
        console.log("--- Baked Hunger LUT ---");
        console.log(bakedUrgencyLUT['hunger']);
        console.log("------------------------");

    } catch (err) {
        console.error("Failed to bake curves. Is the file path correct?", err);
    }
}

// Execute the baker immediately
bakeCurvesToRAM();

// --- NEED MECHANICS CALCULATION ---
function calculateNeed(needName, currentValue, currentHp) {
    // 1. Get the rules for this specific need (hunger, hydration, etc.)
    const rules = ruleSet.needs[needName];

    // Default to the very last bracket (0) just in case
    let activeBracket = rules[rules.length - 1];

    for (const rule of rules) {
        if (currentValue >= rule.thresholds.threshold) {
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
        const agents = await Agent.find({});
        for (const agent of agents) {
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
                current_action_per_tick: null // Stores the divided fraction
            });
        }
        console.log(`Successfully loaded ${liveAgents.size} agents into RAM.`);
    } catch (err) {
        console.error("Failed to initialize game state:", err);
    }
}

// Call this right after loadSimState()
initializeSimulationState();

// 2. The Core Tick Interval (1 real second)
setInterval(async () => {
    if (simPaused) return; // Halt the flow completely

    simTick++;
    redisClient.set('sim:tick', simTick); // Save tick to Redis & Broadcast to Frontend
    io.emit('sim_update', { tick: simTick });

    // B. PROCESS ALL AGENTS FROM RAM
    try {
        const agents = await Agent.find({});

        for (const [agentId, state] of liveAgents.entries()) {
            let needsChanged = false;
            let actionChanged = false;

            // 1. --- APPLY PASSIVE DECAY (Mechanics) ---
            const hungerResult = calculateNeed('hunger', state.needs.hunger || 100, state.needs.health);
            const thirstResult = calculateNeed('thirst', state.needs.thirst || 100, state.needs.health);
            const bladderResult = calculateNeed('bladder', state.needs.bladder || 100, state.needs.health);
            const hygieneResult = calculateNeed('hygiene', state.needs.hygiene || 100, state.needs.health);
            const sleepResult = calculateNeed('sleep', state.needs.sleep || 100, state.needs.health);

            if (hungerResult.newValue !== state.needs.hunger || hungerResult.newHp !== state.needs.health) {
                state.needs.hunger = hungerResult.newValue;
                state.needs.health = hungerResult.newHp;
                needsChanged = true;
            }
            if (thirstResult.newValue !== state.needs.thirst || thirstResult.newHp !== state.needs.health) {
                state.needs.thirst = thirstResult.newValue;
                state.needs.health = thirstResult.newHp;
                needsChanged = true;
            }
            if (bladderResult.newValue !== state.needs.bladder || bladderResult.newHp !== state.needs.health) {
                state.needs.bladder = bladderResult.newValue;
                state.needs.health = bladderResult.newHp;
                needsChanged = true;
            }
            if (hygieneResult.newValue !== state.needs.hygiene || hygieneResult.newHp !== state.needs.health) {
                state.needs.hygiene = hygieneResult.newValue;
                state.needs.health = hygieneResult.newHp;
                needsChanged = true;
            }
            if (sleepResult.newValue !== state.needs.sleep || sleepResult.newHp !== state.needs.health) {
                state.needs.sleep = sleepResult.newValue;
                state.needs.health = sleepResult.newHp;
                needsChanged = true;
            }

            // 2. --- ACTION LOGIC ---
                
            // A. Apply the effects of the FINISHED action
            if (state.current_action_obj && state.current_action_per_tick && simTick < state.busy_until) {
                const e = state.current_action_per_tick;
                state.needs.hunger = Math.max(0, Math.min(100, state.needs.hunger + (e.hunger || 0)));
                state.needs.thirst = Math.max(0, Math.min(100, state.needs.thirst + (e.thirst || 0)));
                state.needs.bladder = Math.max(0, Math.min(100, state.needs.bladder + (e.bladder || 0)));
                state.needs.hygiene = Math.max(0, Math.min(100, state.needs.hygiene + (e.hygiene || 0)));
                state.needs.sleep = Math.max(0, Math.min(100, state.needs.sleep + (e.sleep || 0)));
                state.needs.health = Math.max(0, Math.min(100, state.needs.health + (e.health || 0)));
                needsChanged = true;
            }

            
            // B. Pick a new random action
            if (simTick >= state.busy_until) {

                // Clear the old action data
                state.current_action_obj = null;
                state.current_action_per_tick = null;
                
                if (actionsCache.length > 0) {
                    const randomAction = actionsCache[Math.floor(Math.random() * actionsCache.length)];
                    state.current_action = randomAction._id;
                    state.current_action_obj = randomAction;

                    // Duration is in minutes. 1 tick = 10 minutes. Use Math.ceil to ensure at least 1 tick.
                    const ticksNeeded = Math.max(1, Math.ceil(randomAction.duration / 10));
                    state.busy_until = simTick + ticksNeeded;
                    actionChanged = true;

                    // Calculate Per-Tick Effect (Total Effect / Ticks Needed)
                    const effect = randomAction.needs_effect || {};
                    state.current_action_per_tick = {
                        hunger: (effect.hunger || 0) / ticksNeeded,
                        thirst: (effect.thirst || 0) / ticksNeeded,
                        bladder: (effect.bladder || 0) / ticksNeeded,
                        hygiene: (effect.hygiene || 0) / ticksNeeded,
                        sleep: (effect.sleep || 0) / ticksNeeded,
                        health: (effect.health || 0) / ticksNeeded
                    };

                    // Log the event to MongoDB & Frontend
                    const timeString = formatSimulationTime(simTick);
                    const objectName = randomAction.object ? randomAction.object.name : "Unknown Object";
                    let logString = `${randomAction.name} ${objectName} at ${timeString}`;
                    logString = logString.charAt(0).toUpperCase() + logString.slice(1);

                    const newLog = new EventLog({
                        agent: agentId,
                        event_category: 'action',
                        description: logString,
                        action: randomAction._id
                    });
                    
                    newLog.save().then(savedLog => {
                        io.emit('new_event_log', savedLog);
                    }).catch(err => console.error("EventLog save error:", err));
                }
            }

            // 3. --- REAL-TIME FRONTEND EMIT ---
            if (needsChanged || actionChanged) {
                // Instantly send the live RAM state to the UI
                io.emit('agent_update', {
                    agentId: agentId,
                    needs: state.needs,
                    emotions: state.emotions
                });
            }

            // 4. --- SAVE TO MONGODB ---
            if (needsChanged || actionChanged) {
                const newSnapshot = new AgentSnapshot({
                    agent: agentId,
                    tick: simTick,
                    needs: state.needs,
                    emotions: state.emotions,
                    current_action: state.current_action
                });
                // We don't await this so the loop keeps ticking without waiting for the DB
                newSnapshot.save().catch(err => console.error("Snapshot save error:", err));
            }
        }
    } catch (error) {
        console.error("Tick Processing Error:", error);
    }

}, 1000);


// --- START SERVER ---
// Change from app.listen to server.listen!
server.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});