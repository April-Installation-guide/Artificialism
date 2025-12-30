// src/modules/decisionEngine.js
const ConfidenceScorer = require('./confidenceScorer');
const ActionSelector = require('./actionSelector');

class DecisionEngine {
    constructor() {
        this.confidenceScorer = new ConfidenceScorer();
        this.actionSelector = new ActionSelector();
        this.decisionHistory = new Map();
        this.maxHistoryPerUser = 10;
    }

    /**
     * Proceso completo de toma de decisiones
     */
    async makeDecision(queryAnalysis, externalInfo, context = {}) {
        const startTime = Date.now();
        
        // 1. Calcular confianza
        const confidence = this.confidenceScorer.calculateConfidence(
            queryAnalysis, 
            externalInfo, 
            context
        );
        
        // 2. Seleccionar acción
        const action = this.actionSelector.selectAction(
            confidence, 
            queryAnalysis, 
            context
        );
        
        // 3. Preparar resultado
        const decision = {
            action: action.action,
            confidence: {
                overall: confidence.score,
                level: confidence.level,
                breakdown: confidence.breakdown
            },
            reasoning: {
                primary: action.reason,
                confidenceExplanation: this.confidenceScorer.generateExplanation(confidence),
                actionExplanation: this.getActionExplanation(action)
            },
            instructions: this.actionSelector.getActionInstructions(action.action),
            metadata: {
                processingTime: Date.now() - startTime,
                queryTypes: queryAnalysis.types,
                hasExternalInfo: !!externalInfo && externalInfo.length > 0,
                externalInfoCount: externalInfo ? externalInfo.length : 0,
                timestamp: new Date().toISOString()
            },
            alternatives: action.alternatives,
            shouldProceed: confidence.shouldProceed
        };
        
        // 4. Generar mensaje si es necesario
        if (this.needsSpecialMessage(action.action)) {
            decision.prefixMessage = this.actionSelector.getActionMessage(
                action.action, 
                queryAnalysis.original.substring(0, 100)
            );
        }
        
        // 5. Guardar en historial
        this.saveDecision(context.userId, decision);
        
        logger.debug('Decisión generada', decision);
        
        return decision;
    }

    /**
     * Obtiene explicación detallada de la acción
     */
    getActionExplanation(action) {
        const explanations = {
            direct_response: 'Respuesta directa basada en conocimiento disponible',
            search_external: 'Búsqueda de información externa requerida',
            ask_clarification: 'Se necesita clarificación del usuario',
            defer: 'Mejor no responder por falta de confianza',
            analyze_deeply: 'Análisis profundo requerido',
            give_options: 'Presentar múltiples perspectivas',
            neutral_response: 'Respuesta neutral para tema sensible'
        };
        
        return explanations[action.action] || 'Acción estándar';
    }

    /**
     * Verifica si necesita mensaje especial
     */
    needsSpecialMessage(action) {
        const specialActions = [
            'ask_clarification',
            'defer',
            'neutral_response'
        ];
        
        return specialActions.includes(action);
    }

    /**
     * Guarda decisión en historial
     */
    saveDecision(userId, decision) {
        if (!this.decisionHistory.has(userId)) {
            this.decisionHistory.set(userId, []);
        }
        
        const history = this.decisionHistory.get(userId);
        history.push(decision);
        
        // Limitar historial
        if (history.length > this.maxHistoryPerUser) {
            history.shift();
        }
        
        this.decisionHistory.set(userId, history);
    }

    /**
     * Obtiene historial de decisiones
     */
    getDecisionHistory(userId, limit = 5) {
        const history = this.decisionHistory.get(userId) || [];
        return history.slice(-limit);
    }

    /**
     * Analiza patrones de decisiones
     */
    analyzeDecisionPatterns(userId) {
        const history = this.getDecisionHistory(userId, 20);
        if (history.length < 3) return null;
        
        const patterns = {
            frequentActions: {},
            averageConfidence: 0,
            clarificationRate: 0,
            searchRate: 0
        };
        
        let totalConfidence = 0;
        let clarifications = 0;
        let searches = 0;
        
        history.forEach(decision => {
            // Acciones frecuentes
            const action = decision.action;
            patterns.frequentActions[action] = (patterns.frequentActions[action] || 0) + 1;
            
            // Estadísticas
            totalConfidence += decision.confidence.overall;
            if (action === 'ask_clarification') clarifications++;
            if (action === 'search_external') searches++;
        });
        
        patterns.averageConfidence = totalConfidence / history.length;
        patterns.clarificationRate = clarifications / history.length;
        patterns.searchRate = searches / history.length;
        
        // Ordenar acciones frecuentes
        patterns.frequentActions = Object.entries(patterns.frequentActions)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .reduce((obj, [key, value]) => {
                obj[key] = value;
                return obj;
            }, {});
        
        return patterns;
    }

    /**
     * Adapta el prompt del sistema basado en la decisión
     */
    adaptSystemPrompt(basePrompt, decision, queryAnalysis) {
        let adaptedPrompt = basePrompt;
        
        // Añadir instrucciones basadas en la acción
        const actionInstructions = this.getActionSpecificInstructions(decision.action);
        if (actionInstructions) {
            adaptedPrompt += `\n\n# INSTRUCCIONES ESPECÍFICAS:\n${actionInstructions}`;
        }
        
        // Añadir advertencias basadas en confianza
        if (decision.confidence.level === 'low' || decision.confidence.level === 'very_low') {
            adaptedPrompt += `\n\n# ADVERTENCIA: Confianza baja. Sé especialmente cuidadosa y considera pedir clarificación si es necesario.`;
        }
        
        // Añadir guía para temas sensibles
        if (decision.action === 'neutral_response') {
            adaptedPrompt += `\n\n# TEMA SENSIBLE: Mantén un tono neutral y objetivo. Evita opiniones personales. Proporciona información factual sin tomar posición.`;
        }
        
        // Añadir guía para análisis profundo
        if (decision.action === 'analyze_deeply') {
            adaptedPrompt += `\n\n# ANÁLISIS PROFUNDO: Proporciona una respuesta estructurada. Considera múltiples aspectos. Sé detallada pero concisa.`;
        }
        
        return adaptedPrompt;
    }

    /**
     * Obtiene instrucciones específicas por acción
     */
    getActionSpecificInstructions(action) {
        const instructions = {
            direct_response: 'Responde de manera directa y clara. No des rodeos innecesarios.',
            search_external: 'Incluye información verificada de fuentes externas cuando sea relevante.',
            ask_clarification: 'Pide clarificación de manera educada. Sugiere posibles direcciones.',
            analyze_deeply: 'Estructura la respuesta en puntos claros. Considera diferentes perspectivas.',
            give_options: 'Presenta diferentes interpretaciones u opciones de manera objetiva.',
            neutral_response: 'Mantén neutralidad absoluta. Cita hechos, no opiniones.',
            defer: 'Reconoce las limitaciones educadamente. Ofrece alternativas si es posible.'
        };
        
        return instructions[action];
    }

    /**
     * Evalúa si la decisión fue exitosa (para aprendizaje futuro)
     */
    evaluateDecisionSuccess(decision, userResponse = null) {
        const evaluation = {
            success: true,
            reasons: [],
            score: 0
        };
        
        // Basado en acción tomada
        switch (decision.action) {
            case 'ask_clarification':
                evaluation.success = userResponse ? true : false;
                evaluation.reasons.push(userResponse ? 'Usuario proporcionó clarificación' : 'Sin respuesta del usuario');
                evaluation.score = userResponse ? 0.8 : 0.3;
                break;
                
            case 'defer':
                evaluation.success = true; // Deferir cuando no se está seguro es correcto
                evaluation.reasons.push('Evitó dar una respuesta potencialmente incorrecta');
                evaluation.score = 0.7;
                break;
                
            default:
                // Para otras acciones, asumimos éxito si la confianza era adecuada
                evaluation.success = decision.confidence.overall >= 0.5;
                evaluation.reasons.push(`Confianza ${decision.confidence.overall >= 0.5 ? 'adecuada' : 'insuficiente'}`);
                evaluation.score = decision.confidence.overall;
        }
        
        return evaluation;
    }
}

module.exports = DecisionEngine;
