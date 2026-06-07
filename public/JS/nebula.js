/* Nebula-like background in plain Canvas 2D
   - Stars: rotating field with subtle twinkle
   - Comets: distance-based, smooth tapered tails (default)
              OR original-style ellipse blur (set COMET_MODE = "ellipse")
   - Nebula: TWO independent blob layers with lifecycle modes:
       * "edge": spawn at screen edge, drift across, exit and respawn (recommended)
       * "wrap": toroidal wrap (legacy)
       * "respawn": free drift; when offscreen, respawn anew
   - Skips on mobile/small screens by default
*/

(function () {
    // if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || Math.min(window.innerWidth, window.innerHeight) < 560)
    //     return;

    const canvas = document.getElementById("nebula");
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });

    // "trail": distance-capped tapered stroke
    // "ellipse": emulate original repo (single elongated ellipse blur)
    const COMET_MODE = "ellipse"; // "trail" | "ellipse"

    const CONFIG = {
        paused: false,
        showComets: true,

        // General
        bgColor: "rgb(8, 8, 8)",
        fpsCap: 30,
        devicePixelRatioMax: 1.5,

        // Stars
        starsCount: 5000,
        starsSize: 0.55,
        starsColor: "#FFF",
        starsRotationSpeed: 0.0003,
        twinkle: true,

        // Comets
        cometAverageSeconds: 12,
        cometSpeed: 2500,           // px/s
        cometTailPx: 180,           // distance-based tail length (trail mode)
        cometResampleStepPx: 5,     // max segment length when resampling (trail mode)
        cometHeadRadius: 0.5,
        cometTailWidthHead: 3.0,
        cometTailWidthTail: 0.6,
        cometTailAlphaHead: 0.3,
        cometTailAlphaTail: 0.05,
        // Ellipse mode visuals (original-like)
        cometEllipseHalfLength: 90,
        cometEllipseHalfWidthMin: 0.2,
        cometEllipseHalfWidthMax: 0.8,
        cometEllipseColor: "rgba(255, 255, 255, 1)",

        // Nebula sway wobble (both layers)
        swayAmpMin: 20,
        swayAmpMax: 60,
        swayFreqMin: 0.2,
        swayFreqMax: 0.8,

        // Nebula layers (A = far, B = near)
        // mode: "edge" | "wrap" | "respawn"
        // spawnBias: "uniform" | "center"
        nebulaA: {
            mode: "edge",
            spawnBias: "uniform",
            count: 8,
            radiusMin: 600,
            radiusMax: 1200,
            driftSpeed: 12,  // px/s
            edgeMargin: 150, // spawn/exit margin outside the viewport
            layerAlpha: 1.0,
            colors: [
                "rgba(32, 155, 255, 0.1)",
                "rgba(0, 255, 234, 0.08)",
                "rgba(180, 60, 255, 0.1)",
            ],
        },
        nebulaB: {
            mode: "wrap",
            spawnBias: "uniform",
            count: 16,
            radiusMin: 250,
            radiusMax: 650,
            driftSpeed: 12,  // px/s
            edgeMargin: 150, // spawn/exit margin outside the viewport
            layerAlpha: 1.0,
            colors: [
                "rgba(32, 155, 255, 0.06)",
                "rgba(0, 255, 234, 0.04)",
                "rgba(180, 60, 255, 0.06)",
            ],
        },
    };

    // Canvas + DPR scaling
    let DPR = Math.min(window.devicePixelRatio || 1, CONFIG.devicePixelRatioMax);
    function resize() {
        const { innerWidth: w, innerHeight: h } = window;
        canvas.width = Math.floor(w * DPR);
        canvas.height = Math.floor(h * DPR);
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();

    // Scene state
    const center = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };

    // Keep both nebula layers visually centered on resize
    window.addEventListener("resize", () => {
        const prev = { x: center.x, y: center.y };
        DPR = Math.min(window.devicePixelRatio || 1, CONFIG.devicePixelRatioMax);
        resize();
        center.x = canvas.clientWidth / 2;
        center.y = canvas.clientHeight / 2;
        const dx = center.x - prev.x;
        const dy = center.y - prev.y;
        for (const b of blobsA) { b.x += dx; b.y += dy; }
        for (const b of blobsB) { b.x += dx; b.y += dy; }
    });

    // Stars
    const stars = [];
    (function initStars() {
        const maxR = Math.hypot(center.x, center.y);
        for (let i = 0; i < CONFIG.starsCount; i++) {
            const r = Math.pow(Math.random(), 0.6) * maxR;
            const angle = Math.random() * Math.PI * 2;
            const size =
                (Math.random() < 0.85
                    ? Math.random() * 1.2 + 0.3
                    : Math.random() * 2 + 0.8) * CONFIG.starsSize;
            const twinkleAmp = CONFIG.twinkle ? Math.random() * 0.6 + 0.2 : 0;
            const twinkleSpeed = Math.random() * 2 + 0.5;
            stars.push({
                r, angle, size, twinkleAmp, twinkleSpeed,
                twinklePhase: Math.random() * Math.PI * 2,
            });
        }
    })();

    // Nebula layers
    const blobsA = []; // far
    const blobsB = []; // near

    // Helpers
    function randBetween(a, b) { return a + Math.random() * (b - a); }
    function pickColor(colors) {
        return colors[(Math.random() * colors.length) | 0];
    }

    // Edge spawning utilities
    function pickEdgeSpawn(w, h, margin) {
        const edge = (Math.random() * 4) | 0; // 0:top 1:right 2:bottom 3:left
        switch (edge) {
            case 0: return { x: Math.random() * w, y: -margin, edge };
            case 1: return { x: w + margin, y: Math.random() * h, edge };
            case 2: return { x: Math.random() * w, y: h + margin, edge };
            default: return { x: -margin, y: Math.random() * h, edge };
        }
    }

    function inwardAngleFrom(x, y, wobble = Math.PI / 6) {
        const angToCenter = Math.atan2(center.y - y, center.x - x);
        return angToCenter + randBetween(-wobble, wobble);
    }

    // Blob factory per layer config and mode
    function createBlob(layerCfg) {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        const radius = randBetween(layerCfg.radiusMin, layerCfg.radiusMax);
        let x, y, driftAngle;

        if (layerCfg.mode === "edge") {
            const { x: sx, y: sy } = pickEdgeSpawn(w, h, layerCfg.edgeMargin || 150);
            x = sx; y = sy;
            driftAngle = inwardAngleFrom(x, y);
        } else {
            // "wrap" and "respawn" initial spawn
            if (layerCfg.spawnBias === "uniform") {
                x = Math.random() * w;
                y = Math.random() * h;
            } else { // "center" bias
                const spread = Math.min(w, h) * 0.55;
                const a = Math.random() * Math.PI * 2;
                const r = Math.pow(Math.random(), 0.6) * spread;
                x = center.x + Math.cos(a) * r;
                y = center.y + Math.sin(a) * r;
            }
            driftAngle = Math.random() * Math.PI * 2;
        }

        const color = pickColor(layerCfg.colors);
        const speed = layerCfg.driftSpeed * (0.5 + Math.random());
        const swayAmp = randBetween(CONFIG.swayAmpMin, CONFIG.swayAmpMax);
        const swayFreq = randBetween(CONFIG.swayFreqMin, CONFIG.swayFreqMax);

        return {
            x, y, radius, color,
            driftAngle, speed, swayAmp, swayFreq,
            t: Math.random() * 1000,
            mode: layerCfg.mode,
        };
    }

    function initNebulaLayer(outArray, layerConfig) {
        for (let i = 0; i < layerConfig.count; i++) {
            outArray.push(createBlob(layerConfig));
        }
    }

    initNebulaLayer(blobsA, CONFIG.nebulaA);
    initNebulaLayer(blobsB, CONFIG.nebulaB);

    // Comets
    const comets = [];
    function spawnComet() {
        const edge = Math.floor(Math.random() * 4);
        const w = canvas.clientWidth, h = canvas.clientHeight;
        let x, y, vx, vy;
        const speed = CONFIG.cometSpeed;

        if (edge === 0) {
            x = Math.random() * w; y = -20;
            const tx = Math.random() * w, ty = h + 40;
            const ang = Math.atan2(ty - y, tx - x); vx = Math.cos(ang) * speed; vy = Math.sin(ang) * speed;
        } else if (edge === 1) {
            x = w + 20; y = Math.random() * h;
            const tx = -40, ty = Math.random() * h;
            const ang = Math.atan2(ty - y, tx - x); vx = Math.cos(ang) * speed; vy = Math.sin(ang) * speed;
        } else if (edge === 2) {
            x = Math.random() * w; y = h + 20;
            const tx = Math.random() * w, ty = -40;
            const ang = Math.atan2(ty - y, tx - x); vx = Math.cos(ang) * speed; vy = Math.sin(ang) * speed;
        } else {
            x = -20; y = Math.random() * h;
            const tx = w + 40, ty = Math.random() * h;
            const ang = Math.atan2(ty - y, tx - x); vx = Math.cos(ang) * speed; vy = Math.sin(ang) * speed;
        }

        const lifeMax = 6 + Math.random() * 4;
        comets.push({
            x, y, vx, vy, life: 0, lifeMax,
            trail: [],
            ellipseHalfWidth: lerp(CONFIG.cometEllipseHalfWidthMin, CONFIG.cometEllipseHalfWidthMax, Math.random()),
            direction: Math.atan2(vy, vx),
            color: CONFIG.cometEllipseColor,
        });
    }

    // Math helpers
    function lerp(a, b, t) { return a + (b - a) * t; }
    function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.hypot(dx, dy); }

    // Distance-capped trail helper (for trail mode)
    function resampleAndTrimTrail(trail, newPoint, maxLenPx, stepPx) {
        const last = trail[trail.length - 1];
        if (last) {
            const dx = newPoint.x - last.x;
            const dy = newPoint.y - last.y;
            const d = Math.hypot(dx, dy);
            if (d > stepPx) {
                const n = Math.ceil(d / stepPx);
                for (let i = 1; i <= n; i++) {
                    const t = i / n;
                    trail.push({ x: last.x + dx * t, y: last.y + dy * t });
                }
            } else {
                trail.push(newPoint);
            }
        } else {
            trail.push(newPoint);
        }

        // Trim by cumulative distance from tail to head
        let total = 0;
        for (let i = trail.length - 1; i > 0; i--) {
            const seg = dist(trail[i], trail[i - 1]);
            total += seg;
            if (total > maxLenPx) {
                const overflow = total - maxLenPx;
                const segLen = seg || 1;
                const keep = segLen - overflow;
                const t = keep / segLen;
                const p0 = trail[i - 1], p1 = trail[i];
                const newStart = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
                trail.splice(0, i - 1, newStart);
                break;
            }
        }
    }

    // Timing
    const frameInterval = 1000 / CONFIG.fpsCap;
    let lastTime = performance.now();
    let accumulator = 0;
    let cometAccumulator = 0;

    function loop(now) {
        if (CONFIG.paused) return;

        const dtMs = now - lastTime;
        lastTime = now;
        accumulator += dtMs;
        cometAccumulator += dtMs;

        if (CONFIG.showComets) {
            const cometPeriodMs = CONFIG.cometAverageSeconds * 1000;
            if (cometAccumulator >= cometPeriodMs) {
                spawnComet();
                cometAccumulator = 0;
            } else {
                const chance = (dtMs / cometPeriodMs) * 1.5;
                if (Math.random() < chance * 0.1) spawnComet();
            }
        }

        while (accumulator >= frameInterval) {
            tick(frameInterval / 1000);
            accumulator -= frameInterval;
        }

        draw();
        requestAnimationFrame(loop);
    }

    // Update a single blob with given layer config
    function updateBlob(b, layerCfg, dt) {
        b.t += dt;
        b.x += Math.cos(b.driftAngle) * b.speed * dt;
        b.y += Math.sin(b.driftAngle) * b.speed * dt;
        // Sway wobble
        b.x += Math.cos(b.t * b.swayFreq) * (b.swayAmp * dt);
        b.y += Math.sin(b.t * b.swayFreq) * (b.swayAmp * dt);

        const w = canvas.clientWidth, h = canvas.clientHeight;
        const outMargin = layerCfg.edgeMargin || 150;

        if (layerCfg.mode === "edge") {
            // If fully outside margin bounds, respawn at a new edge
            if (b.x < -outMargin - b.radius || b.x > w + outMargin + b.radius ||
                b.y < -outMargin - b.radius || b.y > h + outMargin + b.radius) {
                const nb = createBlob(layerCfg);
                b.x = nb.x; b.y = nb.y; b.radius = nb.radius; b.color = nb.color;
                b.driftAngle = nb.driftAngle; b.speed = nb.speed;
                b.swayAmp = nb.swayAmp; b.swayFreq = nb.swayFreq; b.t = nb.t;
            }
        } else if (layerCfg.mode === "respawn") {
            // When center goes outside margin bounds, respawn anywhere per bias
            if (b.x < -outMargin || b.x > w + outMargin ||
                b.y < -outMargin || b.y > h + outMargin) {
                const nb = createBlob(layerCfg);
                b.x = nb.x; b.y = nb.y; b.radius = nb.radius; b.color = nb.color;
                b.driftAngle = nb.driftAngle; b.speed = nb.speed;
                b.swayAmp = nb.swayAmp; b.swayFreq = nb.swayFreq; b.t = nb.t;
            }
        } else {
            // "wrap": toroidal wrapping with a capped margin (avoid huge waits)
            const wrapMargin = Math.min(300, b.radius * 0.5); // cap margin
            if (b.x < -wrapMargin) b.x = w + wrapMargin;
            if (b.x > w + wrapMargin) b.x = -wrapMargin;
            if (b.y < -wrapMargin) b.y = h + wrapMargin;
            if (b.y > h + wrapMargin) b.y = -wrapMargin;
        }
    }

    function updateBlobs(layer, layerCfg, dt) {
        for (const b of layer) updateBlob(b, layerCfg, dt);
    }

    function tick(dt) {
        // Nebula drift with lifecycle enforcement
        updateBlobs(blobsA, CONFIG.nebulaA, dt);
        updateBlobs(blobsB, CONFIG.nebulaB, dt);

        // Stars
        for (const s of stars) {
            s.angle += CONFIG.starsRotationSpeed;
            if (s.angle > Math.PI * 2) s.angle -= Math.PI * 2;
            s.twinklePhase += s.twinkleSpeed * dt;
        }

        // Comets
        for (let i = comets.length - 1; i >= 0; i--) {
            const c = comets[i];
            c.life += dt;
            c.x += c.vx * dt;
            c.y += c.vy * dt;
            c.direction = Math.atan2(c.vy, c.vx);

            if (COMET_MODE === "trail") {
                resampleAndTrimTrail(
                    c.trail,
                    { x: c.x, y: c.y },
                    CONFIG.cometTailPx,
                    CONFIG.cometResampleStepPx
                );
            }

            if (
                c.life > c.lifeMax ||
                c.x < -200 || c.x > canvas.clientWidth + 200 ||
                c.y < -200 || c.y > canvas.clientHeight + 200
            ) {
                comets.splice(i, 1);
            }
        }
    }

    function drawBackground() {
        ctx.fillStyle = CONFIG.bgColor;
        ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    }

    function drawNebulaLayer(layer, layerAlpha = 1) {
        for (const b of layer) {
            const grd = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.radius);
            grd.addColorStop(0.0, b.color);
            grd.addColorStop(1.0, "rgba(0,0,0,0)");
            ctx.globalAlpha = layerAlpha; // multiplies color alpha
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function drawNebula() {
        const prevOp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = "lighter";
        // Draw far first, near second
        drawNebulaLayer(blobsA, CONFIG.nebulaA.layerAlpha);
        drawNebulaLayer(blobsB, CONFIG.nebulaB.layerAlpha);
        ctx.globalCompositeOperation = prevOp;
    }

    function drawStars() {
        ctx.fillStyle = CONFIG.starsColor;
        for (const s of stars) {
            const x = center.x + Math.cos(s.angle) * s.r;
            const y = center.y + Math.sin(s.angle) * s.r;
            let alpha = 1;
            if (CONFIG.twinkle) {
                alpha = 0.6 + Math.sin(s.twinklePhase) * 0.4 * s.twinkleAmp;
                alpha = Math.max(0.1, Math.min(1, alpha));
            }
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(x, y, s.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function drawComets() {
        if (COMET_MODE === "ellipse") return drawCometsEllipse();

        // trail mode (distance-capped, smooth, tapered)
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalCompositeOperation = "lighter";

        for (const c of comets) {
            const trail = c.trail;
            if (trail.length < 2) continue;

            // total trail length (already <= cometTailPx)
            let total = 0;
            for (let i = 1; i < trail.length; i++) total += dist(trail[i], trail[i - 1]);

            // Stroke segments with width/alpha as a function of cumulative distance
            let acc = 0;
            for (let i = 1; i < trail.length; i++) {
                const p0 = trail[i - 1];
                const p1 = trail[i];
                const segLen = dist(p0, p1);
                acc += segLen;
                const t = total > 0 ? acc / total : 1; // 0 tail -> 1 head

                const width =
                    CONFIG.cometTailWidthTail +
                    (CONFIG.cometTailWidthHead - CONFIG.cometTailWidthTail) * t;
                const alpha =
                    CONFIG.cometTailAlphaTail +
                    (CONFIG.cometTailAlphaHead - CONFIG.cometTailAlphaTail) * t;

                ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
                ctx.lineWidth = width;
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.stroke();
            }

            // Head: small bright dot with subtle glow
            ctx.shadowColor = "#ffffff";
            ctx.shadowBlur = 10;
            ctx.globalAlpha = 1;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(c.x, c.y, CONFIG.cometHeadRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        ctx.restore();
        ctx.globalAlpha = 1;
    }

    function drawCometsEllipse() {
        for (const c of comets) {
            ctx.save();
            ctx.translate(c.x, c.y);
            ctx.rotate(c.direction + Math.PI / 2);

            const halfLen = CONFIG.cometEllipseHalfLength;
            const halfWidth = c.ellipseHalfWidth;

            ctx.beginPath();
            ctx.ellipse(0, 0, halfWidth, halfLen, 0, 0, Math.PI * 2);

            const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, halfLen);
            grd.addColorStop(0, "rgba(255, 255, 255, 0.9)");
            grd.addColorStop(1, "rgba(255, 255, 255, 0)");
            ctx.fillStyle = grd;
            ctx.globalAlpha = 0.8;
            ctx.fill();

            ctx.restore();
        }
    }

    function draw() {
        drawBackground();
        drawNebula();  // far then near
        drawStars();
        drawComets();
    }

    requestAnimationFrame(loop);

    window.NebulaAPI = {
        setPaused: function(state) {
            if (state && !CONFIG.paused) {
                CONFIG.paused = true;
            } else if (!state && CONFIG.paused) {
                CONFIG.paused = false;
                lastTime = performance.now(); // Reset timer to prevent a massive jump catch-up
                requestAnimationFrame(loop);
            }
        },
        toggleComets: function(state) {
            CONFIG.showComets = state;
            if (!state) comets.length = 0; // Instantly clear existing comets
        }
    };
})();

// --- STAR STYLING
const leftButton = document.querySelector('#left .original');
const rightButton = document.querySelector('#right .original');
var stars = document.querySelectorAll("#buttons svg");

leftButton.addEventListener('mouseenter', () => {
    setTimeout(() => {
        if (leftButton.matches(':hover')) {
            stars[0].setAttribute('fill', 'white');
            stars[0].style.animation = "shake 0.3s ease-in-out infinite";
        }
    }, 200);
});

leftButton.addEventListener('mouseleave', () => {
    stars[0].setAttribute('fill', 'none');
    stars[0].style.animation = "none";
});

rightButton.addEventListener('mouseenter', () => {
    setTimeout(() => {
        if (rightButton.matches(':hover')) {
            stars[1].setAttribute('fill', 'white');
            stars[1].style.animation = "shake 0.3s ease-in-out infinite";
        }
    }, 200);
});

rightButton.addEventListener('mouseleave', () => {
    stars[1].setAttribute('fill', 'none');
    stars[1].style.animation = "none";
});

// BUTTON INTERACTION
const title = document.getElementById('title');
const bar = document.getElementsByTagName('hr')[0];
const auxBar = document.getElementById('aux-bar');
const closeButton = document.getElementById('close-button');
const buttonContainer = document.getElementById('buttons');
const contentBox = document.getElementById('content');
const cssFormPadding = window.getComputedStyle(document.documentElement).getPropertyValue('--form-padding').replace("rem", "") * 16;
var cssFormHeight = 600;
var cssFormWidth = 500;
var form = null;
var submitButton = null;

// Set CSS variables for form dimensions
document.documentElement.style.setProperty('--form-height', `${cssFormHeight}px`);
document.documentElement.style.setProperty('--form-width', `${cssFormWidth}px`);

// Degub locate function
function debugLocate(x, y) {
    console.log(`X: ${x}, Y: ${y}`);
    let dot = document.createElement('div');
    dot.style.position = 'absolute';
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    dot.style.width = '5px';
    dot.style.height = '5px';
    dot.style.backgroundColor = 'red';
    dot.style.zIndex = '1000';
    dot.style.borderRadius = '50%';
    document.body.appendChild(dot);
}

// Log In and Sign Up button handlers
function loginButton() {
    buttonContainer.style.pointerEvents = "none";
    buttonContainer.style.visibility = "hidden";
    moveTitleUp();
    openForm('login');
}

function signupButton() {
    buttonContainer.style.pointerEvents = "none";
    buttonContainer.style.visibility = "hidden";
    moveTitleUp();
    openForm('signup');
}

// Closing form button handler
async function closeFormButton() {
    closeForm();
    closeSubmitButton();
    resetTitle();
    await new Promise(resolve => setTimeout(resolve, 1000));
    buttonContainer.style.pointerEvents = "auto";
    buttonContainer.style.visibility = "visible";
}

window.addEventListener("keydown", (event) => {
    // console.log(`Key pressed: ${event.key}`);
    if (event.key === "Escape" && !closeButton.disabled) {
        closeFormButton();
        event.preventDefault();
    }
});

window.addEventListener("click", (event) => {
    console.log("Window clicked! Target:", event.target);

    // Ignore clicks on the main button container (Log In / Sign Up toggles)
    if (typeof buttonContainer !== 'undefined' && buttonContainer && buttonContainer.contains(event.target)) {
        console.log("Click ignored: Originated from main buttons container.");
        return;
    }

    // NEW: Ignore clicks on the Submit button, because it lives outside the <form> tags!
    if (typeof submitButton !== 'undefined' && submitButton && submitButton.contains(event.target)) {
        console.log("Click ignored: Originated from Submit button.");
        return;
    }

    // Close the form if the click is truly outside
    if (form && !form.contains(event.target) && event.target !== closeButton && !closeButton.disabled) {
        console.log("Click outside form detected! Closing form...");
        closeFormButton();
        event.preventDefault();
    }
});

// Animations and transitions to translate title and turn bars into the closing button
async function moveTitleUp () {
    title.style.transform = "translateY(-50vh)";
    bar.style.animation = "none";
    auxBar.style.animation = "none";
    void bar.offsetWidth;
    void auxBar.offsetWidth;
    bar.style.animation = "bar-up-a 1s ease-in-out 0s 1 normal forwards";
    auxBar.style.animation = "bar-up-b 1s ease-in-out 0s 1 normal forwards";
    await new Promise(resolve => setTimeout(resolve, 1000));
    closeButton.style.cursor = "pointer";
    closeButton.disabled = false;
}

async function resetTitle() {
    bar.style.animation = "none";
    auxBar.style.animation = "none";
    void bar.offsetWidth;
    void auxBar.offsetWidth;
    bar.style.animation = "bar-up-a 1s ease-in-out 0s 1 reverse forwards";
    auxBar.style.animation = "bar-up-b 1s ease-in-out 0s 1 reverse forwards";
    closeButton.style.cursor = "default";
    closeButton.disabled = true;
    await new Promise(resolve => setTimeout(resolve, 1000));
    title.style.transform = "translateY(0)";
}

// Form opening and element creation for the DOM
async function openForm(button) {
    let fields = button === 'login' ? ['username', 'password'] : ['username', 'email', 'password', 'password2'];
    cssFormHeight = (fields.length * 106) + 55 + (cssFormPadding * 2); 
    document.documentElement.style.setProperty('--form-height', `${cssFormHeight}px`);
    
    form = document.createElement('form');
    form.id = 'auth-form';
    
    submitButton = document.createElement('button');
    submitButton.setAttribute('form', 'auth-form');
    submitButton.type = 'submit';
    submitButton.id = 'submit-button';
    submitButton.textContent = button === 'login' ? 'Log In' : 'Sign Up';
    submitButton.disabled = true;

    const contentRect = contentBox.getBoundingClientRect();
    const buttonRect = button === 'login' ? leftButton.getBoundingClientRect() : rightButton.getBoundingClientRect();

    const formLeft = buttonRect.left - contentRect.left;
    const formTop = buttonRect.top - contentRect.top + (3 * 16); 
    form.style.setProperty("--start-left", `${formLeft}px`);
    form.style.setProperty("--start-top", `${formTop}px`);

    const submitLeft = buttonRect.left - contentRect.left;
    const submitTop = buttonRect.top - contentRect.top;
    submitButton.style.left = submitLeft + "px";
    submitButton.style.top = submitTop + "px";
    submitButton.style.setProperty("--start-left", `${submitLeft}px`);
    submitButton.style.setProperty("--end-top", `calc(50% + ${(cssFormHeight / 2) - cssFormPadding - buttonRect.height}px)`);
    submitButton.style.animation = "form-open-submit 1s ease-in-out 0s 1 normal forwards";

    contentBox.appendChild(form);
    form.classList.add('auth-form');
    contentBox.appendChild(submitButton);

    await new Promise(resolve => setTimeout(resolve, 500));

    let formHtml = '';
    fields.forEach(e => {
        // Assign the correct input type (using HTML5 email validation as a first line of defense)
        let inputType = "text";
        if (e === "password" || e === "password2") inputType = "password";
        if (e === "email") inputType = "email";

        // Generate the label text dynamically
        let labelText = e.charAt(0).toUpperCase() + e.slice(1);
        if (e === "password2") labelText = "Repeat Password";
        if (e === "username" && button === "login") labelText = "Username or Email";

        formHtml += `
            <label for="${e}">
                <p>${labelText}:</p>
                <input type="${inputType}" name="${e}" id="auth-form-${e}" required>
            </label>
        `;
    });
    
    form.innerHTML = formHtml;
    let formFields = form.querySelectorAll('label');
    formFields.forEach(field => {
        field.style.animation = "label-in 0.5s ease-in-out 0s 1 normal forwards";
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    submitButton.disabled = false;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        
        const formData = new FormData(form);
        const dataPayload = Object.fromEntries(formData.entries());
        
        // Frontend Sanitization: Trim trailing/leading spaces from all payload data
        for (let key in dataPayload) {
            dataPayload[key] = dataPayload[key].trim();
        }
        
        const targetUrl = button === 'login' ? '/api/login' : '/api/signup';

        try {
            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataPayload)
            });

            const result = await response.json();

            if (result.success) {
                window.location.href = "/home.html";
            } else {
                console.warn("Backend rejected the submission:", result.message);
                
                // Clear previous red borders
                formFields.forEach(label => {
                    const input = label.querySelector('input');
                    if (input) input.style.borderColor = "";
                });

                // Map specific backend errors to UI highlighting
                if (button === "login") {
                    if (result.message === "Account doesn't exist.") {
                        let input = formFields[0].querySelector('input');
                        input.style.borderColor = "#ff4d4d";
                        formFields[0].innerHTML = formFields[0].innerHTML.replace("Username or Email:", `Username or Email: <span style="color: #ff4d4d">Account doesn't exist</span>`);
                    } else if (result.message === "Incorrect password.") {
                        let input = formFields[1].querySelector('input');
                        input.style.borderColor = "#ff4d4d";
                        formFields[1].innerHTML = formFields[1].innerHTML.replace("Password:", `Password: <span style="color: #ff4d4d">Incorrect password</span>`);
                    }
                } else {
                    if (result.message === "Passwords do not match.") {
                        formFields[2].querySelector('input').style.borderColor = "#ff4d4d";
                        formFields[3].querySelector('input').style.borderColor = "#ff4d4d";
                        formFields[2].innerHTML = formFields[2].innerHTML.replace("Password:", `Password: <span style="color: #ff4d4d">Passwords do not match</span>`);
                    } else if (result.message === "Username already exists.") {
                        formFields[0].querySelector('input').style.borderColor = "#ff4d4d";
                        formFields[0].innerHTML = formFields[0].innerHTML.replace("Username:", `Username: <span style="color: #ff4d4d">Username already exists</span>`);
                    } else if (result.message === "Email already in use.") {
                        formFields[1].querySelector('input').style.borderColor = "#ff4d4d";
                        formFields[1].innerHTML = formFields[1].innerHTML.replace("Email:", `Email: <span style="color: #ff4d4d">Email already in use</span>`);
                    } else if (result.message === "Invalid email format.") {
                        formFields[1].querySelector('input').style.borderColor = "#ff4d4d";
                        formFields[1].innerHTML = formFields[1].innerHTML.replace("Email:", `Email: <span style="color: #ff4d4d">Invalid format</span>`);
                    } else if (result.message === "Password must be at least 6 characters.") {
                        formFields[2].querySelector('input').style.borderColor = "#ff4d4d";
                        formFields[2].innerHTML = formFields[2].innerHTML.replace("Password:", `Password: <span style="color: #ff4d4d">Too short (min 6)</span>`);
                    }
                }
            }
        } catch (error) {
            console.error("Fetch error occurred during form submission:", error);
        }
    });
}

async function closeForm() {
    if (form) {
        form.style.animation = "none";
        void form.offsetWidth;
        form.style.animation = "form-open 1s ease-in-out 0s 1 reverse forwards";    
        let formFields = form.querySelectorAll('label');
        formFields.forEach(field => {
            field.style.animation = "none";
            void field.offsetWidth;
            field.style.animation = "label-in 0.3s ease-in-out 0s 1 reverse forwards";
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
        contentBox.removeChild(form);
        form = null;
    }
}

async function closeSubmitButton() {
    if (submitButton) {
        submitButton.style.animation = "none";
        void submitButton.offsetWidth;
        submitButton.style.animation = "form-open-submit 1s ease-in-out 0s 1 reverse forwards";
        await new Promise(resolve => setTimeout(resolve, 1000));
        contentBox.removeChild(submitButton);
        submitButton = null;
    }
}