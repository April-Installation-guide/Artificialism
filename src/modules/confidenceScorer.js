// src/modules/confidenceScorer.js
class ConfidenceScorer {
    constructor() {
        this.weights = {
            questionClarity: 0.25,
            informationAvailability: 0.30,
            contextRelevance: 0.20,
            historicalAccuracy: 0.15,
            responseQuality: 0.10
        };
    }

    /**
     * Calcula la confianza general para responder
     */
    calculateConfidence(queryAnalysis, externalInfo, context) {
        const scores = {};
        
        // 1. Claridad de la pregunta
        scores.questionClarity = this.scoreQuestionClarity(queryAnalysis.original);
        
        // 2. Disponibilidad de información
        scores.informationAvailability = this.scoreInformationAvailability(externalInfo, queryAnalysis);
        
        // 3. Relevancia del contexto
        scores.contextRelevance = this.scoreContextRelevance(context, queryAnalysis);
        
        // 4. Precisión histórica (si hay historial)
        scores.historicalAccuracy = this.scoreHistoricalAccuracy(context?.history);
        
        // 5. Calidad de respuesta potencial
        scores.responseQuality = this.scoreResponseQuality(queryAnalysis, externalInfo);
        
        // Calcular puntuación ponderada
        let totalScore = 0;
        let totalWeight = 0;
        
        for (const [factor, weight] of Object.entries(this.weights)) {
            if (scores[factor] !== undefined) {
                totalScore += scores[factor] * weight;
                totalWeight += weight;
            }
        }
        
        const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0.5;
        
        return {
            score: finalScore,
            breakdown: scores,
            level: this.getConfidenceLevel(finalScore),
            shouldProceed: finalScore >= 0.4,
            needsClarification: scores.questionClarity < 0.3
        };
    }

    /**
     * Evalúa claridad de la pregunta
     */
    scoreQuestionClarity(question) {
        let score = 0.5;
        
        // Puntos positivos
        if (question.length > 10 && question.length < 200) score += 0.2;
        if (question.includes('?')) score += 0.1;
        if (question.trim().split(/\s+/).length > 3) score += 0.1;
        
        // Puntos negativos
        if (question.length < 5) score -= 0.3;
        if (question.length > 300) score -= 0.2;
        if (/^\s*[.!¿?]+\s*$/.test(question)) score = 0.1; // Solo puntuación
        
        // Preguntas demasiado vagas
        const vaguePatterns = [
            /^(qué|quién|cómo|dónde|cuándo)\s*$/i,
            /explícame$/i,
            /dime$/i,
            /habla\s+(de|sobre)$/i
        ];
        
        if (vaguePatterns.some(pattern => pattern.test(question.trim()))) {
            score -= 0.4;
        }
        
        return Math.max(0.1, Math.min(1, score));
    }

    /**
     * Evalúa disponibilidad de información
     */
    scoreInformationAvailability(externalInfo, queryAnalysis) {
        if (!externalInfo || externalInfo.length === 0) {
            // Si la pregunta parece necesitar info pero no tenemos
            if (queryAnalysis.needsExternalInfo) {
                return 0.2;
            }
            // Si es una pregunta conversacional, no necesariamente necesita info
            return 0.6;
        }
        
        // Tenemos información externa
        let score = 0.7;
        
        // Calidad de la información
        const hasWikipedia = externalInfo.some(info => info.source === 'Wikipedia');
        const hasBooks = externalInfo.some(info => info.source === 'OpenLibrary');
        
        if (hasWikipedia) score += 0.2;
        if (hasBooks && queryAnalysis.types.includes('books')) score += 0.1;
        
        // Cantidad de fuentes
        if (externalInfo.length >= 2) score += 0.1;
        
        return Math.min(1, score);
    }

    /**
     * Evalúa relevancia del contexto
     */
    scoreContextRelevance(context, queryAnalysis) {
        if (!context || !context.lastResponse) {
            return 0.5; // Neutral sin contexto
        }
        
        const lastResponse = context.lastResponse.toLowerCase();
        const currentQuestion = queryAnalysis.original.toLowerCase();
        
        let relevance = 0.3; // Base
        
        // Coincidencia de temas
        const topics = this.extractTopics(lastResponse);
        const questionTopics = this.extractTopics(currentQuestion);
        
        const matchingTopics = topics.filter(topic => 
            questionTopics.some(qt => qt.includes(topic) || topic.includes(qt))
        );
        
        if (matchingTopics.length > 0) {
            relevance += 0.4;
        }
        
        // Seguimiento lógico
        const isFollowUp = this.isLogicalFollowUp(lastResponse, currentQuestion);
        if (isFollowUp) {
            relevance += 0.3;
        }
        
        return Math.min(1, relevance);
    }

    /**
     * Evalúa precisión histórica
     */
    scoreHistoricalAccuracy(history) {
        if (!history || history.length === 0) return 0.5;
        
        // Por ahora, puntuación base
        // Podrías extender esto para analizar feedback real
        return 0.7;
    }

    /**
     * Evalúa calidad potencial de respuesta
     */
    scoreResponseQuality(queryAnalysis, externalInfo) {
        let score = 0.5;
        
        // Preguntas bien estructuradas
        const wellStructured = queryAnalysis.original.match(/\w+.*\?/);
        if (wellStructured) score += 0.2;
        
        // Información disponible
        if (externalInfo && externalInfo.length > 0) {
            const hasGoodContent = externalInfo.some(info => 
                info.content && info.content.length > 50
            );
            if (hasGoodContent) score += 0.3;
        }
        
        // No temas sensibles
        if (!this.hasSensitiveTopics(queryAnalysis.original)) {
            score += 0.1;
        }
        
        return Math.min(1, score);
    }

    /**
     * Extrae temas de un texto
     */
    extractTopics(text) {
        const words = text.toLowerCase()
            .replace(/[^\w\sáéíóúñ]/gi, ' ')
            .split(/\s+/)
            .filter(word => word.length > 4);
        
        const stopWords = new Set(['sobre', 'acerca', 'decir', 'puedes', 'podrías', 'quiero', 'saber']);
        return words.filter(word => !stopWords.has(word)).slice(0, 5);
    }

    /**
     * Verifica si es un seguimiento lógico
     */
    isLogicalFollowUp(lastResponse, currentQuestion) {
        const followUpIndicators = [
            'pero', 'sin embargo', 'aunque', 'además',
            'y qué', 'y cómo', 'y por qué', 'y cuándo',
            'entonces', 'también', 'por otro lado'
        ];
        
        return followUpIndicators.some(indicator => 
            currentQuestion.includes(indicator)
        );
    }

    /**
     * Verifica temas sensibles
     */
    hasSensitiveTopics(text) {
        const sensitive = [
            /polític(a|o)/i, /religi(ón|oso)/i,
            /sexo/i, /droga/i, /violencia/i,
            /opinión personal/i, /qué piensas/i
        ];
        
        return sensitive.some(pattern => pattern.test(text));
    }

    /**
     * Convierte puntuación a nivel de confianza
     */
    getConfidenceLevel(score) {
        if (score >= 0.8) return 'high';
        if (score >= 0.6) return 'medium';
        if (score >= 0.4) return 'low';
        return 'very_low';
    }

    /**
     * Genera explicación para el usuario
     */
    generateExplanation(confidenceResult) {
        const { score, level, needsClarification } = confidenceResult;
        
        if (needsClarification) {
            return "Parece que tu pregunta es un poco vaga. ¿Podrías especificar más?";
        }
        
        if (level === 'very_low') {
            return "No estoy segura de poder responder eso adecuadamente.";
        }
        
        if (level === 'low') {
            return "Intentaré responder, pero puede que no tenga toda la información.";
        }
        
        if (level === 'medium') {
            return "Creo que puedo darte una respuesta útil.";
        }
        
        return "Estoy bastante segura de esta respuesta.";
    }
}

module.exports = ConfidenceScorer;
