
// src/modules/actionSelector.js
class ActionSelector {
    constructor() {
        this.actions = {
            DIRECT_RESPONSE: 'direct_response',
            SEARCH_EXTERNAL: 'search_external',
            ASK_CLARIFICATION: 'ask_clarification',
            DEFER: 'defer',
            ANALYZE_DEEPLY: 'analyze_deeply',
            GIVE_OPTIONS: 'give_options',
            NEUTRAL_RESPONSE: 'neutral_response'
        };
        
        this.rules = [
            // Regla 1: Preguntas muy vagas
            {
                condition: (confidence, analysis) => confidence.score < 0.3,
                action: this.actions.ASK_CLARIFICATION,
                priority: 1.0
            },
            
            // Regla 2: Necesita información externa
            {
                condition: (confidence, analysis) => analysis.needsExternalInfo,
                action: this.actions.SEARCH_EXTERNAL,
                priority: 0.9
            },
            
            // Regla 3: Tema sensible
            {
                condition: (confidence, analysis) => this.isSensitiveTopic(analysis.original),
                action: this.actions.NEUTRAL_RESPONSE,
                priority: 0.85
            },
            
            // Regla 4: Pregunta compleja
            {
                condition: (confidence, analysis) => this.isComplexQuestion(analysis.original),
                action: this.actions.ANALYZE_DEEPLY,
                priority: 0.8
            },
            
            // Regla 5: Múltiples opciones posibles
            {
                condition: (confidence, analysis) => this.hasMultipleInterpretations(analysis.original),
                action: this.actions.GIVE_OPTIONS,
                priority: 0.75
            },
            
            // Regla 6: Confianza alta - responder directamente
            {
                condition: (confidence, analysis) => confidence.score >= 0.7,
                action: this.actions.DIRECT_RESPONSE,
                priority: 0.7
            },
            
            // Regla 7: Confianza media - proceder con cuidado
            {
                condition: (confidence, analysis) => confidence.score >= 0.5 && confidence.score < 0.7,
                action: this.actions.DIRECT_RESPONSE,
                priority: 0.6
            },
            
            // Regla 8: Confianza muy baja - diferir
            {
                condition: (confidence, analysis) => confidence.score < 0.4 && !analysis.needsExternalInfo,
                action: this.actions.DEFER,
                priority: 0.5
            }
        ];
    }

    /**
     * Selecciona la mejor acción basada en análisis
     */
    selectAction(confidenceScore, queryAnalysis, context = {}) {
        const applicableRules = [];
        
        // Evaluar cada regla
        for (const rule of this.rules) {
            if (rule.condition(confidenceScore, queryAnalysis, context)) {
                applicableRules.push({
                    action: rule.action,
                    priority: rule.priority,
                    reason: this.getRuleReason(rule, queryAnalysis)
                });
            }
        }
        
        // Ordenar por prioridad
        applicableRules.sort((a, b) => b.priority - a.priority);
        
        if (applicableRules.length === 0) {
            return this.getDefaultAction();
        }
        
        // Seleccionar la acción de mayor prioridad
        const selectedRule = applicableRules[0];
        
        return {
            action: selectedRule.action,
            priority: selectedRule.priority,
            reason: selectedRule.reason,
            alternatives: applicableRules.slice(1, 3).map(r => r.action),
            confidence: confidenceScore.score
        };
    }

    /**
     * Verifica si es un tema sensible
     */
    isSensitiveTopic(question) {
        const sensitivePatterns = [
            /opinas sobre/i,
            /qué piensas de/i,
            /estás de acuerdo/i,
            /polític(a|o)/i,
            /religi(ón|oso)/i,
            /sexo/i,
            /dinero.*personal/i
        ];
        
        return sensitivePatterns.some(pattern => pattern.test(question.toLowerCase()));
    }

    /**
     * Verifica si es pregunta compleja
     */
    isComplexQuestion(question) {
        const complexityIndicators = [
            /explica.*detalladamente/i,
            /comparar.*y.*/i,
            /ventajas.*desventajas/i,
            /causas.*consecuencias/i,
            /analizar.*/i,
            /múltiples.*factores/i
        ];
        
        const wordCount = question.split(/\s+/).length;
        const hasMultipleQuestions = (question.match(/\?/g) || []).length > 1;
        
        return complexityIndicators.some(pattern => pattern.test(question)) ||
               (wordCount > 25 && hasMultipleQuestions);
    }

    /**
     * Verifica si tiene múltiples interpretaciones
     */
    hasMultipleInterpretations(question) {
        const ambiguousPatterns = [
            /puede.*significar/i,
            /depende.*/i,
            /por un lado.*por otro/i,
            /algunos.*otros/i,
            /tal vez.*o quizás/i
        ];
        
        const connectors = (question.match(/ o | y | pero | aunque /gi) || []).length;
        
        return ambiguousPatterns.some(pattern => pattern.test(question)) || connectors >= 2;
    }

    /**
     * Obtiene razón de la regla
     */
    getRuleReason(rule, analysis) {
        const reasons = {
            [this.actions.ASK_CLARIFICATION]: 'Pregunta demasiado vaga o ambigua',
            [this.actions.SEARCH_EXTERNAL]: 'Necesita información factual verificable',
            [this.actions.NEUTRAL_RESPONSE]: 'Tema sensible que requiere neutralidad',
            [this.actions.ANALYZE_DEEPLY]: 'Pregunta compleja que requiere análisis detallado',
            [this.actions.GIVE_OPTIONS]: 'Múltiples interpretaciones posibles',
            [this.actions.DEFER]: 'Confianza insuficiente para responder adecuadamente',
            [this.actions.DIRECT_RESPONSE]: 'Pregunta clara con información suficiente'
        };
        
        return reasons[rule.action] || 'Acción estándar seleccionada';
    }

    /**
     * Acción por defecto
     */
    getDefaultAction() {
        return {
            action: this.actions.DIRECT_RESPONSE,
            priority: 0.5,
            reason: 'Acción por defecto',
            alternatives: [],
            confidence: 0.5
        };
    }

    /**
     * Genera instrucciones para el sistema basadas en la acción
     */
    getActionInstructions(action) {
        const instructions = {
            [this.actions.DIRECT_RESPONSE]: {
                tone: 'direct',
                length: 'normal',
                includeSources: false,
                disclaimer: false
            },
            [this.actions.SEARCH_EXTERNAL]: {
                tone: 'informative',
                length: 'detailed',
                includeSources: true,
                disclaimer: false
            },
            [this.actions.ASK_CLARIFICATION]: {
                tone: 'curious',
                length: 'brief',
                includeSources: false,
                disclaimer: true
            },
            [this.actions.DEFER]: {
                tone: 'humble',
                length: 'brief',
                includeSources: false,
                disclaimer: true
            },
            [this.actions.ANALYZE_DEEPLY]: {
                tone: 'analytical',
                length: 'detailed',
                includeSources: true,
                disclaimer: true
            },
            [this.actions.GIVE_OPTIONS]: {
                tone: 'exploratory',
                length: 'moderate',
                includeSources: false,
                disclaimer: true
            },
            [this.actions.NEUTRAL_RESPONSE]: {
                tone: 'neutral',
                length: 'moderate',
                includeSources: true,
                disclaimer: true
            }
        };
        
        return instructions[action] || instructions[this.actions.DIRECT_RESPONSE];
    }

    /**
     * Genera mensaje inicial basado en la acción
     */
    getActionMessage(action, question) {
        const messages = {
            [this.actions.ASK_CLARIFICATION]: [
                `"${question}" - Podrías especificar un poco más lo que buscas?`,
                `Interesante pregunta. Para responderte mejor, ¿podrías dar más detalles?`,
                `Hmm, esa pregunta puede interpretarse de varias formas. ¿A qué aspecto te refieres exactamente?`
            ],
            [this.actions.DEFER]: [
                `Sobre "${question}", prefiero ser cuidadosa. No tengo suficiente confianza para darte una respuesta adecuada.`,
                `Esa es una pregunta interesante, pero creo que necesitaría más información para responderte bien.`,
                `Como chica gato seria, prefiero admitir cuando no estoy completamente segura. ¿Quizás otra pregunta?`
            ],
            [this.actions.NEUTRAL_RESPONSE]: [
                `Sobre ese tema, puedo compartir información objetiva:`,
                `Como asistente, me limito a proporcionar información factual sobre eso:`,
                `Hay diferentes perspectivas al respecto. Te comparto lo que sé:`
            ]
        };
        
        const actionMessages = messages[action];
        if (actionMessages) {
            return actionMessages[Math.floor(Math.random() * actionMessages.length)];
        }
        
        return null; // Para acciones que no necesitan mensaje especial
    }
}

module.exports = ActionSelector;
