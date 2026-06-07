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
    // const normalizedReward = (rawDelta / durationTicks) - 0.5;
    const normalizedReward = rawDelta - 0.1;
    
    return normalizedReward;
}

/**
 * Updates the agent's memory (weights) using Gradient Descent.
 * New Weight = Old Weight + (Learning_Rate * Reward * Urgency_At_The_Time)
 */
function updateWeights(weightsMap, lastActionId, lastUrgencies, needRewards) {
    for (const need in lastUrgencies) {
        const urgencyAtStart = lastUrgencies[need];

        // We only update the weight if the need was actively felt
        if (urgencyAtStart > 0) {
            const weightKey = `${lastActionId}_${need}`;
            const currentWeight = weightsMap[weightKey] || 0;

            const actualReward = needRewards[need] || 0;
            const predictedQ = currentWeight * urgencyAtStart;
            const error = actualReward - predictedQ;

            // Gradient Descent
            let newWeight = currentWeight + (ALPHA * error * urgencyAtStart);

            // Weight Clipping (Regularization)
            // Prevents weights from exploding to infinity when urgencyAtStart is near 0.
            // Bounding between -5.0 and 5.0 provides a stable matrix.
            newWeight = Math.max(-5.0, Math.min(5.0, newWeight));

            weightsMap[weightKey] = newWeight;
        }
    }
    return weightsMap;
}

/**
 * Selects an action using Epsilon-Greedy logic based on Q-Values.
 */
function selectAction(actionsCache, urgencies, weightsMap, currentEpsilon) {
    // EXPLORE: Pick randomly using the agent's dynamic epsilon
    if (Math.random() < currentEpsilon) {
        return actionsCache[Math.floor(Math.random() * actionsCache.length)];
    }

    // EXPLOIT: Pick the action with the highest expected reward (Q-Value)
    let bestAction = null;
    let highestQValue = -Infinity;

    for (const action of actionsCache) {
        let qValue = 0;
        
        // Calculate Q-Value: Sum of (Weight * Current Urgency)
        for (const need in urgencies) {
            const weightKey = `${action._id}_${need}`;
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