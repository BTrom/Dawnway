const SECONDS_PER_TICK = 600;
const TICKS_PER_HOUR = 3600 / SECONDS_PER_TICK;

const ruleSet = {
    needs: {
        hunger: {
            priority: 0,
            
            thresholds: [
                { threshold: 75, rate: -2.08  / TICKS_PER_HOUR, urgency: 0, hpDecay: 0 },
                { threshold: 40, rate: -0.94  / TICKS_PER_HOUR, urgency: 0, hpDecay: 0 },
                { threshold: 15, rate: -0.035 / TICKS_PER_HOUR, urgency: 0, hpDecay: -0.1 / TICKS_PER_HOUR },
                { threshold:  1, rate: -0.019 / TICKS_PER_HOUR, urgency: 0, hpDecay: -1.5 / TICKS_PER_HOUR },
                { threshold:  0, rate:  0, urgency: 0, hpDecay: -10 }
            ]
        },
        thirst: {
            thresholds: [
                { threshold: 80, rate: -2.5 / TICKS_PER_HOUR, urgency: 0, hpDecay: 0 },
                { threshold: 50, rate: -1.8 / TICKS_PER_HOUR, urgency: 0, hpDecay: -0.5 / TICKS_PER_HOUR },
                { threshold: 25, rate: -1.0 / TICKS_PER_HOUR, urgency: 0, hpDecay: -2   / TICKS_PER_HOUR },
                { threshold:  1, rate: -1.0 / TICKS_PER_HOUR, urgency: 0, hpDecay: -5   / TICKS_PER_HOUR },
                { threshold:  0, rate:  0, urgency: 0, hpDecay: -10 }
            ]
        },
        bladder: {
            thresholds: [
                { threshold: 75, rate: -10 / TICKS_PER_HOUR, urgency: 0, hpDecay: 0 },
                { threshold: 40, rate: -10 / TICKS_PER_HOUR, urgency: 0, hpDecay: 0 },
                { threshold: 20, rate: -10 / TICKS_PER_HOUR, urgency: 0, hpDecay: 0 },
                { threshold:  0, rate: -10 / TICKS_PER_HOUR, urgency: 0, hpDecay: 0 }
            ]
        },
        hygiene: {
            thresholds: [
                { threshold: 75, rate: -0.26  / TICKS_PER_HOUR, urgency: 0, hpDecay: 0 },
                { threshold: 40, rate: -0.09  / TICKS_PER_HOUR, urgency: 0, hpDecay: 0 },
                { threshold: 10, rate: -0.05  / TICKS_PER_HOUR, urgency: 0, hpDecay: -0.05 / TICKS_PER_HOUR },
                { threshold:  0, rate: -0.025 / TICKS_PER_HOUR, urgency: 0, hpDecay: -0.2  / TICKS_PER_HOUR }
            ]
        },
        sleep: {
            thresholds: [
                { threshold: 80, rate: -1.25 / TICKS_PER_HOUR, urgency: 0, hpDecay: 0 },
                { threshold: 50, rate: -1.5  / TICKS_PER_HOUR, urgency: 0, hpDecay: -0.1 / TICKS_PER_HOUR },
                { threshold: 25, rate: -1.04 / TICKS_PER_HOUR, urgency: 0, hpDecay: -1   / TICKS_PER_HOUR },
                { threshold:  1, rate: -0.6  / TICKS_PER_HOUR, urgency: 0, hpDecay: -3   / TICKS_PER_HOUR },
                { threshold:  0, rate:  0, urgency: 0, hpDecay: -10 }
            ]
        }
    }
}

module.exports = {
    SECONDS_PER_TICK,
    ruleSet
};