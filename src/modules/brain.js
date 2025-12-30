// src/brain.js
const DecisionMaker = require('./modules/decisionMaker');
const Analyzer = require('./modules/analyzer');

class Brain {
    constructor() {
        this.decisionMaker = new DecisionMaker();
        this.analyzer = new Analyzer();
        this.memory = [];
    }

    async process(input) {
        // 1. Analizar entrada
        const analysis = await this.analyzer.analyze(input);
        
        // 2. ¿Requiere decisión?
        if (analysis.requiresDecision) {
            const decision = await this.decisionMaker.makeDecision(
                input, 
                { analysis, memory: this.memory }
            );
            
            // 3. Guardar en memoria
            this.memory.push({
                input,
                analysis,
                decision,
                timestamp: Date.now()
            });
            
            return decision;
        }
        
        // Respuesta directa si no requiere decisión compleja
        return { response: this.directResponse(analysis) };
    }
}
