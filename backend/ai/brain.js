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
function updateWeights(weightsMap, memoryData, lastActionId, lastUrgencies, needRewards) {
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
            newWeight = Math.max(-5.0, Math.min(5.0, newWeight));
            weightsMap[weightKey] = newWeight;

            // EBBINGHAUS: Reinforce memory strength
            // The more an action is taken for a need, the slower it will be forgotten later.
            if (!memoryData[weightKey]) {
                memoryData[weightKey] = { strength: 1 };
            } else {
                memoryData[weightKey].strength += 0.5; 
            }
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
    let bestActions = [];
    let highestQValue = -Infinity;

    for (const action of actionsCache) {
        let qValue = 0;
        
        // Calculate Q-Value: Sum of (Weight * Current Urgency)
        for (const need in urgencies) {
            const weightKey = `${action._id}_${need}`;
            const weight = weightsMap[weightKey] || 0;
            qValue += weight * urgencies[need];
        }

        // If we find a strictly better action, clear the array and start over
        if (qValue > highestQValue) {
            highestQValue = qValue;
            bestActions = [action];
        } else if (qValue === highestQValue) {
            bestActions.push(action); // Tie found, add to the array
        }
    }

    // Break the tie by picking randomly from the bestActions array
    if (bestActions.length > 0) {
        return bestActions[Math.floor(Math.random() * bestActions.length)];
    }

    // Ultimate fallback
    return actionsCache[Math.floor(Math.random() * actionsCache.length)];
}

/**
 * Applies the Ebbinghaus Forgetting Curve to decay weights towards 0.
 * Formula: Retention = e^(-t * rate / S)
 */
function applyEbbinghausForgetting(weightsMap, memoryData, ticksPassed) {
    // Tune this rate. Higher means they forget Q-values faster.
    const FORGETTING_RATE = 0.005; 

    for (const key in weightsMap) {
        if (memoryData[key]) {
            const strength = Math.max(1, memoryData[key].strength);
            
            // Calculate how much memory is retained over the passed ticks
            const retention = Math.exp(-(ticksPassed * FORGETTING_RATE) / strength);
            
            // Decay the weight towards zero
            weightsMap[key] = weightsMap[key] * retention;
        }
    }
    return weightsMap;
}

/**
 * Passively shares knowledge from a teacher to a student.
 * Gated by a minimum teacher confidence, and restricted to the current shared action.
 */
function absorbKnowledge(studentWeights, studentMemory, teacherWeights, teacherMemory, currentActionId) {
    const TAU = 0.1; // Social Learning Rate: How much they learn per tick of exposure
    const MIN_TEACHER_STRENGTH = 5.0; // The "Elder" threshold

    for (const key in teacherWeights) {
        // Restrict sharing to the action they are currently performing together
        if (!key.startsWith(`${currentActionId}_`)) {
            continue;
        }

        const teacherStrength = teacherMemory[key] ? teacherMemory[key].strength : 0;
        const studentStrength = studentMemory[key] ? studentMemory[key].strength : 0;

        // Only learn if the teacher is more experienced with this specific knowledge
        if (teacherStrength >= MIN_TEACHER_STRENGTH && teacherStrength > studentStrength + 1.0) { // +1.0 threshold prevents swapping negligible differences
            const tWeight = teacherWeights[key];
            const sWeight = studentWeights[key] || 0;

            // Soft Update (Polyak Averaging)
            studentWeights[key] = sWeight + (TAU * (tWeight - sWeight));

            // Boost the student's memory strength slightly so they retain the taught knowledge
            if (!studentMemory[key]) {
                studentMemory[key] = { strength: 1.5 }; // Base strength for taught knowledge
            } else {
                studentMemory[key].strength += 0.1; 
            }
        }
    }
    
    return { updatedWeights: studentWeights, updatedMemory: studentMemory };
}

module.exports = {
    calculateTotalDiscomfort,
    calculateReward,
    updateWeights,
    selectAction,
    applyEbbinghausForgetting,
    absorbKnowledge
};