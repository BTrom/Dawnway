const EPSILON = 0.2; // 20% of the time, pick randomly to explore and learn
const ALPHA = 0.1;   // How fast they learn (Learning Rate)

/**
 * Calculates the total current discomfort of the agent.
 * Formula: Sum of all (Urgency * Priority)
 */
function calculateTotalDiscomfort(urgencies, priorities) {
    let discomfort = 0;
    for (const need in urgencies) {
        const urgency = urgencies[need] || 0;
        const priority = priorities[need] || 1;
        discomfort += urgency * priority;   
    }
    return discomfort;
}

/**
 * Calculates the reward based on the Delta approach, adjusted to prevent Reward Hacking.
 * Reward = Discomfort_Before - Discomfort_After
 */
function calculateReward(discomfortBefore, discomfortAfter, durationTicks) {
    // The standard Delta reward
    const rawDelta = discomfortBefore - discomfortAfter;
    
    // REWARD HACKING FIX: 
    // 1. Normalize by time so they prefer efficient actions.
    // 2. Subtract a flat 0.5 initiation penalty so they don't spam micro-actions.
    const normalizedReward = (rawDelta / durationTicks) - 0.5;
    
    return normalizedReward;
}

/**
 * Updates the agent's memory (weights) using Gradient Descent.
 * New Weight = Old Weight + (Learning_Rate * Reward * Urgency_At_The_Time)
 */
function updateWeights(weightsMap, lastActionId, lastUrgencies, reward) {
    for (const need in lastUrgencies) {
        const urgencyAtStart = lastUrgencies[need];

        // Only update if the urgency was actually present
        if (urgencyAtStart > 0) {
            const weightKey = `${lastActionId}_${need}`; // e.g., "actionID_thirst"
            const currentWeight = weightsMap[weightKey] || 0;

            // Expected reward for a blank slate is 0, so Error = Actual Reward
            const error = reward;

            // Apply gradient descent
            const newWeight = currentWeight + (ALPHA * error * urgencyAtStart);
            weightsMap[weightKey] = newWeight;
        }
    }
    return weightsMap;
}

/**
 * Selects an action using Epsilon-Greedy logic based on Q-Values.
 */
function selectAction(actionsCache, urgencies, weightsMap) {
    // EXPLORE: Pick randomly
    if (Math.random() < EPSILON) {
        return actionsCache[Math.floor(Math.random() * actionsCache.length)];
    }

    // EXPLOIT: Pick the action with the highest expected reward (Q-Value)
    let bestAction = null;
    let highestQValue = -Infinity;

    for (const action of actionsCache) {
        let qValue = 0;
        
        // Calculate Q-Value: Sum of (Weight * Current Urgency)
        for (const need in urgencies) {
            const weightKey = `${action.id}_${need}`;
            const weight = weightsMap[weightKey] || 0;
            qValue += weight * urgencies[need];
        }

        if (qValue > highestQValue) {
            highestQValue = qValue;
            bestAction = action;
        }
    }

    // Fallback just in case
    return bestAction || actionsCache[Math.floor(Math.random() * actionsCache.length)];
}

module.exports = {
    calculateTotalDiscomfort,
    calculateReward,
    updateWeights,
    selectAction
};