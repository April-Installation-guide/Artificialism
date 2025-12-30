import { Client, GatewayIntentBits, ActivityType, EmbedBuilder, Colors, Partials } from 'discord.js';
import Groq from "groq-sdk";
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { setTimeout as sleep } from 'timers/promises';
import { createHash } from 'crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { existsSync, mkdirSync } from 'fs';

// Cargar variables de entorno
dotenv.config();

// ==================== CONFIGURACIÓN ====================
const CONFIG = {
    BOT_NAME: 'Mancy',
    BOT_VERSION: '2.0.1',
    
    // Groq Configuration
    GROQ_MODEL: 'llama-3.1-8b-instant',
    GROQ_FALLBACK_MODEL: 'llama-3.1-70b-versatile',
    GROQ_MAX_TOKENS: 400,
    GROQ_TEMPERATURE: 0.25,
    GROQ_TIMEOUT: 45000,
    GROQ_MAX_RETRIES: 3,
    
    // Rate Limiting
    USER_COOLDOWN_MS: 2000,
    GLOBAL_RATE_LIMIT: 5,
    MAX_CONCURRENT_REQUESTS: 3,
    
    // Conversation
    MAX_HISTORY_MESSAGES: 6,
    MAX_CONTEXT_TOKENS: 2000,
    CONTEXT_SUMMARY_THRESHOLD: 8,
    
    // Caching
    SEARCH_CACHE_TTL: 900000,
    RESPONSE_CACHE_TTL: 300000,
    EMBEDDING_CACHE_TTL: 86400000,
    
    // API Timeouts
    WIKIPEDIA_TIMEOUT: 8000,
    OPENLIBRARY_TIMEOUT: 10000,
    
    // System
    CLEANUP_INTERVAL_MS: 300000,
    HEALTH_CHECK_INTERVAL_MS: 60000,
    MAX_CONVERSATIONS_IN_MEMORY: 500,
    
    // Database
    DB_PATH: './data/mancy.db',
    
    // Monitoring
    ENABLE_METRICS: true,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};

// ==================== VALIDACIÓN DE ENTORNO ====================
const REQUIRED_ENV_VARS = ['GROQ_API_KEY', 'DISCORD_TOKEN'];
const missingVars = REQUIRED_ENV_VARS.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ ERROR: Variables de entorno faltantes:', missingVars);
    console.error('Configura estas variables en Render/Heroku/Vercel');
    process.exit(1);
}

// ==================== SISTEMA DE LOGGING MEJORADO ====================
const LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    trace: 4
};

class Logger {
    constructor(level = 'info') {
        this.level = LOG_LEVELS[level] || LOG_LEVELS.info;
    }

    _log(level, emoji, message, data = null) {
        if (LOG_LEVELS[level] > this.level) return;
        
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${emoji} ${message}`;
        
        if (data) {
            if (typeof data === 'object') {
                console[level](logMessage, JSON.stringify(data, null, 2));
            } else {
                console[level](logMessage, data);
            }
        } else {
            console[level](logMessage);
        }
    }

    error(message, data) { this._log('error', '❌', message, data); }
    warn(message, data) { this._log('warn', '⚠️', message, data); }
    info(message, data) { this._log('info', 'ℹ️', message, data); }
    debug(message, data) { this._log('debug', '🔍', message, data); }
    trace(message, data) { this._log('trace', '📝', message, data); }
    
    metric(name, value, tags = {}) {
        if (CONFIG.ENABLE_METRICS) {
            this.info(`METRIC ${name}=${value}`, tags);
        }
    }
}

const logger = new Logger(CONFIG.LOG_LEVEL);

// ==================== MÓDULOS DE DECISIÓN INTEGRADOS ====================

// 1. CONFIDENCE SCORER
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

    calculateConfidence(queryAnalysis, externalInfo, context) {
        const scores = {};
        
        scores.questionClarity = this.scoreQuestionClarity(queryAnalysis.original);
        scores.informationAvailability = this.scoreInformationAvailability(externalInfo, queryAnalysis);
        scores.contextRelevance = this.scoreContextRelevance(context, queryAnalysis);
        scores.historicalAccuracy = this.scoreHistoricalAccuracy(context?.history);
        scores.responseQuality = this.scoreResponseQuality(queryAnalysis, externalInfo);
        
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

    scoreQuestionClarity(question) {
        let score = 0.5;
        
        if (question.length > 10 && question.length < 200) score += 0.2;
        if (question.includes('?')) score += 0.1;
        if (question.trim().split(/\s+/).length > 3) score += 0.1;
        
        if (question.length < 5) score -= 0.3;
        if (question.length > 300) score -= 0.2;
        if (/^\s*[.!¿?]+\s*$/.test(question)) score = 0.1;
        
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

    scoreInformationAvailability(externalInfo, queryAnalysis) {
        if (!externalInfo || externalInfo.length === 0) {
            if (queryAnalysis.needsExternalInfo) {
                return 0.2;
            }
            return 0.6;
        }
        
        let score = 0.7;
        const hasWikipedia = externalInfo.some(info => info.source === 'Wikipedia');
        const hasBooks = externalInfo.some(info => info.source === 'OpenLibrary');
        
        if (hasWikipedia) score += 0.2;
        if (hasBooks && queryAnalysis.types.includes('books')) score += 0.1;
        if (externalInfo.length >= 2) score += 0.1;
        
        return Math.min(1, score);
    }

    scoreContextRelevance(context, queryAnalysis) {
        if (!context || !context.lastResponse) {
            return 0.5;
        }
        
        const lastResponse = context.lastResponse.toLowerCase();
        const currentQuestion = queryAnalysis.original.toLowerCase();
        
        let relevance = 0.3;
        
        const topics = this.extractTopics(lastResponse);
        const questionTopics = this.extractTopics(currentQuestion);
        
        const matchingTopics = topics.filter(topic => 
            questionTopics.some(qt => qt.includes(topic) || topic.includes(qt))
        );
        
        if (matchingTopics.length > 0) {
            relevance += 0.4;
        }
        
        const followUpIndicators = [
            'pero', 'sin embargo', 'aunque', 'además',
            'y qué', 'y cómo', 'y por qué', 'y cuándo',
            'entonces', 'también', 'por otro lado'
        ];
        
        const isFollowUp = followUpIndicators.some(indicator => 
            currentQuestion.includes(indicator)
        );
        
        if (isFollowUp) {
            relevance += 0.3;
        }
        
        return Math.min(1, relevance);
    }

    extractTopics(text) {
        const words = text.toLowerCase()
            .replace(/[^\w\sáéíóúñ]/gi, ' ')
            .split(/\s+/)
            .filter(word => word.length > 4);
        
        const stopWords = new Set(['sobre', 'acerca', 'decir', 'puedes', 'podrías', 'quiero', 'saber']);
        return words.filter(word => !stopWords.has(word)).slice(0, 5);
    }

    scoreHistoricalAccuracy(history) {
        if (!history || history.length === 0) return 0.5;
        return 0.7;
    }

    scoreResponseQuality(queryAnalysis, externalInfo) {
        let score = 0.5;
        
        const wellStructured = queryAnalysis.original.match(/\w+.*\?/);
        if (wellStructured) score += 0.2;
        
        if (externalInfo && externalInfo.length > 0) {
            const hasGoodContent = externalInfo.some(info => 
                info.content && info.content.length > 50
            );
            if (hasGoodContent) score += 0.3;
        }
        
        const sensitive = [
            /polític(a|o)/i, /religi(ón|oso)/i,
            /sexo/i, /droga/i, /violencia/i,
            /opinión personal/i, /qué piensas/i
        ];
        
        if (!sensitive.some(pattern => pattern.test(queryAnalysis.original))) {
            score += 0.1;
        }
        
        return Math.min(1, score);
    }

    getConfidenceLevel(score) {
        if (score >= 0.8) return 'high';
        if (score >= 0.6) return 'medium';
        if (score >= 0.4) return 'low';
        return 'very_low';
    }

    generateExplanation(confidenceResult) {
        const { level, needsClarification } = confidenceResult;
        
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

// 2. ACTION SELECTOR
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
            {
                condition: (confidence, analysis) => confidence.score < 0.3,
                action: this.actions.ASK_CLARIFICATION,
                priority: 1.0
            },
            {
                condition: (confidence, analysis) => analysis.needsExternalInfo,
                action: this.actions.SEARCH_EXTERNAL,
                priority: 0.9
            },
            {
                condition: (confidence, analysis) => this.isSensitiveTopic(analysis.original),
                action: this.actions.NEUTRAL_RESPONSE,
                priority: 0.85
            },
            {
                condition: (confidence, analysis) => this.isComplexQuestion(analysis.original),
                action: this.actions.ANALYZE_DEEPLY,
                priority: 0.8
            },
            {
                condition: (confidence, analysis) => this.hasMultipleInterpretations(analysis.original),
                action: this.actions.GIVE_OPTIONS,
                priority: 0.75
            },
            {
                condition: (confidence, analysis) => confidence.score >= 0.7,
                action: this.actions.DIRECT_RESPONSE,
                priority: 0.7
            },
            {
                condition: (confidence, analysis) => confidence.score >= 0.5 && confidence.score < 0.7,
                action: this.actions.DIRECT_RESPONSE,
                priority: 0.6
            },
            {
                condition: (confidence, analysis) => confidence.score < 0.4 && !analysis.needsExternalInfo,
                action: this.actions.DEFER,
                priority: 0.5
            }
        ];
    }

    selectAction(confidenceScore, queryAnalysis, context = {}) {
        const applicableRules = [];
        
        for (const rule of this.rules) {
            if (rule.condition(confidenceScore, queryAnalysis, context)) {
                applicableRules.push({
                    action: rule.action,
                    priority: rule.priority,
                    reason: this.getRuleReason(rule, queryAnalysis)
                });
            }
        }
        
        applicableRules.sort((a, b) => b.priority - a.priority);
        
        if (applicableRules.length === 0) {
            return this.getDefaultAction();
        }
        
        const selectedRule = applicableRules[0];
        
        return {
            action: selectedRule.action,
            priority: selectedRule.priority,
            reason: selectedRule.reason,
            alternatives: applicableRules.slice(1, 3).map(r => r.action),
            confidence: confidenceScore.score
        };
    }

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

    getDefaultAction() {
        return {
            action: this.actions.DIRECT_RESPONSE,
            priority: 0.5,
            reason: 'Acción por defecto',
            alternatives: [],
            confidence: 0.5
        };
    }

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
        
        return null;
    }
}

// 3. DECISION ENGINE
class DecisionEngine {
    constructor() {
        this.confidenceScorer = new ConfidenceScorer();
        this.actionSelector = new ActionSelector();
        this.decisionHistory = new Map();
        this.maxHistoryPerUser = 10;
    }

    async makeDecision(queryAnalysis, externalInfo, context = {}) {
        const startTime = Date.now();
        
        const confidence = this.confidenceScorer.calculateConfidence(
            queryAnalysis, 
            externalInfo, 
            context
        );
        
        const action = this.actionSelector.selectAction(
            confidence, 
            queryAnalysis, 
            context
        );
        
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
        
        if (this.needsSpecialMessage(action.action)) {
            decision.prefixMessage = this.actionSelector.getActionMessage(
                action.action, 
                queryAnalysis.original.substring(0, 100)
            );
        }
        
        this.saveDecision(context.userId, decision);
        
        logger.debug('Decisión generada', {
            action: decision.action,
            confidence: decision.confidence.overall,
            reasoning: decision.reasoning.primary
        });
        
        return decision;
    }

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

    needsSpecialMessage(action) {
        const specialActions = [
            'ask_clarification',
            'defer',
            'neutral_response'
        ];
        
        return specialActions.includes(action);
    }

    saveDecision(userId, decision) {
        if (!this.decisionHistory.has(userId)) {
            this.decisionHistory.set(userId, []);
        }
        
        const history = this.decisionHistory.get(userId);
        history.push(decision);
        
        if (history.length > this.maxHistoryPerUser) {
            history.shift();
        }
        
        this.decisionHistory.set(userId, history);
    }

    getDecisionHistory(userId, limit = 5) {
        const history = this.decisionHistory.get(userId) || [];
        return history.slice(-limit);
    }

    adaptSystemPrompt(basePrompt, decision, queryAnalysis) {
        let adaptedPrompt = basePrompt;
        
        const actionInstructions = this.getActionSpecificInstructions(decision.action);
        if (actionInstructions) {
            adaptedPrompt += `\n\n# INSTRUCCIONES ESPECÍFICAS:\n${actionInstructions}`;
        }
        
        if (decision.confidence.level === 'low' || decision.confidence.level === 'very_low') {
            adaptedPrompt += `\n\n# ADVERTENCIA: Confianza baja. Sé especialmente cuidadosa y considera pedir clarificación si es necesario.`;
        }
        
        if (decision.action === 'neutral_response') {
            adaptedPrompt += `\n\n# TEMA SENSIBLE: Mantén un tono neutral y objetivo. Evita opiniones personales. Proporciona información factual sin tomar posición.`;
        }
        
        if (decision.action === 'analyze_deeply') {
            adaptedPrompt += `\n\n# ANÁLISIS PROFUNDO: Proporciona una respuesta estructurada. Considera múltiples aspectos. Sé detallada pero concisa.`;
        }
        
        return adaptedPrompt;
    }

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
}

// ==================== BASE DE DATOS SQLite ====================
class Database {
    constructor() {
        this.db = null;
        this.initialized = false;
    }

    async initialize() {
        try {
            if (!existsSync('./data')) {
                mkdirSync('./data', { recursive: true });
            }

            this.db = await open({
                filename: CONFIG.DB_PATH,
                driver: sqlite3.Database
            });

            await this.createTables();
            this.initialized = true;
            logger.info('Base de datos inicializada', { path: CONFIG.DB_PATH });
        } catch (error) {
            logger.error('Error inicializando base de datos', error);
            throw error;
        }
    }

    async createTables() {
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                guild_id TEXT,
                message_hash TEXT NOT NULL,
                user_message TEXT NOT NULL,
                bot_response TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                model_used TEXT,
                response_time INTEGER,
                has_external_info BOOLEAN DEFAULT 0,
                UNIQUE(user_id, message_hash)
            );

            CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
            CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp);

            CREATE TABLE IF NOT EXISTS user_stats (
                user_id TEXT PRIMARY KEY,
                total_interactions INTEGER DEFAULT 0,
                last_interaction DATETIME,
                preferred_topics TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS api_cache (
                key_hash TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at);
        `);
    }

    async saveConversation(conversation) {
        if (!this.initialized) return;
        
        try {
            await this.db.run(
                `INSERT OR REPLACE INTO conversations 
                (user_id, guild_id, message_hash, user_message, bot_response, model_used, response_time, has_external_info) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    conversation.userId,
                    conversation.guildId,
                    conversation.messageHash,
                    conversation.userMessage,
                    conversation.botResponse,
                    conversation.modelUsed,
                    conversation.responseTime,
                    conversation.hasExternalInfo ? 1 : 0
                ]
            );

            await this.db.run(
                `INSERT OR REPLACE INTO user_stats (user_id, total_interactions, last_interaction) 
                VALUES (?, COALESCE((SELECT total_interactions + 1 FROM user_stats WHERE user_id = ?), 1), CURRENT_TIMESTAMP)`,
                [conversation.userId, conversation.userId]
            );
        } catch (error) {
            logger.error('Error guardando conversación', error);
        }
    }

    async getRecentConversations(userId, limit = 5) {
        if (!this.initialized) return [];
        
        try {
            return await this.db.all(
                `SELECT user_message, bot_response, timestamp 
                 FROM conversations 
                 WHERE user_id = ? 
                 ORDER BY timestamp DESC 
                 LIMIT ?`,
                [userId, limit]
            );
        } catch (error) {
            logger.error('Error obteniendo conversaciones', error);
            return [];
        }
    }

    async getCache(keyHash) {
        if (!this.initialized) return null;
        
        try {
            const result = await this.db.get(
                `SELECT data FROM api_cache 
                 WHERE key_hash = ? AND expires_at > CURRENT_TIMESTAMP`,
                [keyHash]
            );
            return result ? JSON.parse(result.data) : null;
        } catch (error) {
            logger.error('Error obteniendo cache', error);
            return null;
        }
    }

    async setCache(keyHash, data, ttlMs) {
        if (!this.initialized) return;
        
        try {
            const expiresAt = new Date(Date.now() + ttlMs).toISOString();
            await this.db.run(
                `INSERT OR REPLACE INTO api_cache (key_hash, data, expires_at) 
                 VALUES (?, ?, ?)`,
                [keyHash, JSON.stringify(data), expiresAt]
            );
        } catch (error) {
            logger.error('Error guardando cache', error);
        }
    }

    async cleanupExpiredCache() {
        if (!this.initialized) return;
        
        try {
            const result = await this.db.run(
                `DELETE FROM api_cache WHERE expires_at <= CURRENT_TIMESTAMP`
            );
            if (result.changes > 0) {
                logger.debug('Cache limpiado', { deleted: result.changes });
            }
        } catch (error) {
            logger.error('Error limpiando cache', error);
        }
    }
}

const database = new Database();

// ==================== SISTEMA DE CACHÉ MEJORADO ====================
class EnhancedCache {
    constructor() {
        this.memoryCache = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            size: 0
        };
    }

    generateKey(prefix, data) {
        const str = typeof data === 'string' ? data : JSON.stringify(data);
        return `${prefix}:${createHash('md5').update(str).digest('hex')}`;
    }

    async get(key, useDatabase = true) {
        const memoryItem = this.memoryCache.get(key);
        if (memoryItem && Date.now() < memoryItem.expiry) {
            this.stats.hits++;
            return memoryItem.data;
        }
        
        if (useDatabase) {
            const dbData = await database.getCache(key);
            if (dbData) {
                this.memoryCache.set(key, {
                    data: dbData,
                    expiry: Date.now() + CONFIG.RESPONSE_CACHE_TTL
                });
                this.stats.hits++;
                return dbData;
            }
        }
        
        this.stats.misses++;
        return null;
    }

    async set(key, data, ttl = CONFIG.RESPONSE_CACHE_TTL, persistInDb = false) {
        const item = {
            data,
            expiry: Date.now() + ttl
        };
        
        this.memoryCache.set(key, item);
        this.stats.size = this.memoryCache.size;
        
        if (persistInDb) {
            await database.setCache(key, data, ttl);
        }
    }

    delete(key) {
        this.memoryCache.delete(key);
        this.stats.size = this.memoryCache.size;
    }

    cleanup() {
        const now = Date.now();
        let deleted = 0;
        
        for (const [key, value] of this.memoryCache.entries()) {
            if (now > value.expiry) {
                this.memoryCache.delete(key);
                deleted++;
            }
        }
        
        this.stats.size = this.memoryCache.size;
        if (deleted > 0) {
            logger.debug('Cache en memoria limpiado', { deleted });
        }
    }

    getStats() {
        return {
            ...this.stats,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0
        };
    }
}

const searchCache = new EnhancedCache();
const responseCache = new EnhancedCache();

// ==================== SISTEMA DE RATE LIMITING MEJORADO ====================
class RateLimiter {
    constructor() {
        this.userBuckets = new Map();
        this.globalRequests = [];
        this.concurrentRequests = 0;
    }

    canProcessUser(userId) {
        const now = Date.now();
        const userBucket = this.userBuckets.get(userId) || { tokens: CONFIG.GLOBAL_RATE_LIMIT, lastRefill: now };
        
        const timePassed = now - userBucket.lastRefill;
        const refillAmount = Math.floor(timePassed / 10000) * CONFIG.GLOBAL_RATE_LIMIT;
        
        if (refillAmount > 0) {
            userBucket.tokens = Math.min(userBucket.tokens + refillAmount, CONFIG.GLOBAL_RATE_LIMIT);
            userBucket.lastRefill = now;
        }
        
        if (userBucket.tokens <= 0) {
            logger.debug('Rate limit - Sin tokens', { userId, tokens: userBucket.tokens });
            return false;
        }
        
        const tenSecondsAgo = now - 10000;
        this.globalRequests = this.globalRequests.filter(time => time > tenSecondsAgo);
        
        if (this.globalRequests.length >= CONFIG.GLOBAL_RATE_LIMIT * 5) {
            logger.debug('Rate limit - Global excedido', { 
                userId, 
                globalRequests: this.globalRequests.length 
            });
            return false;
        }
        
        if (this.concurrentRequests >= CONFIG.MAX_CONCURRENT_REQUESTS) {
            logger.debug('Rate limit - Concurrencia máxima', { 
                userId, 
                concurrent: this.concurrentRequests 
            });
            return false;
        }
        
        return true;
    }

    consumeToken(userId) {
        if (!this.canProcessUser(userId)) {
            return false;
        }
        
        const userBucket = this.userBuckets.get(userId) || { tokens: CONFIG.GLOBAL_RATE_LIMIT, lastRefill: Date.now() };
        userBucket.tokens--;
        this.userBuckets.set(userId, userBucket);
        
        this.globalRequests.push(Date.now());
        this.concurrentRequests++;
        
        logger.debug('Token consumido', { 
            userId, 
            remainingTokens: userBucket.tokens,
            concurrent: this.concurrentRequests 
        });
        
        return true;
    }

    releaseToken() {
        this.concurrentRequests = Math.max(0, this.concurrentRequests - 1);
        logger.debug('Token liberado', { concurrent: this.concurrentRequests });
    }

    getUserWaitTime(userId) {
        const userBucket = this.userBuckets.get(userId);
        if (!userBucket || userBucket.tokens > 0) return 0;
        
        const timeSinceRefill = Date.now() - userBucket.lastRefill;
        return Math.max(0, 10000 - timeSinceRefill);
    }
}

const rateLimiter = new RateLimiter();

// ==================== CLIENTES PRINCIPALES ====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageTyping
    ],
    partials: [Partials.Channel, Partials.Message],
    presence: {
        activities: [{
            name: 'solo responde a replies',
            type: ActivityType.Watching
        }],
        status: 'online'
    }
});

const groq = new Groq({ 
    apiKey: process.env.GROQ_API_KEY, 
    timeout: CONFIG.GROQ_TIMEOUT,
    maxRetries: CONFIG.GROQ_MAX_RETRIES
});

// ==================== TEST DE CONEXIÓN GROQ ====================
async function testGroqConnection() {
    try {
        logger.info('🧪 Probando conexión con Groq API...');
        const test = await groq.chat.completions.create({
            messages: [{ role: 'user', content: 'Responde con OK si funciono' }],
            model: CONFIG.GROQ_MODEL,
            max_tokens: 5
        });
        const response = test.choices[0]?.message?.content || 'Sin respuesta';
        logger.info('✅ Conexión Groq OK', { response });
        return true;
    } catch (error) {
        logger.error('❌ Conexión Groq falló', { error: error.message });
        return false;
    }
}

// ==================== PROMPT Y PERSONALIDAD ====================
const SYSTEM_PROMPT = `Eres ${CONFIG.BOT_NAME}, una chica gato seria, reservada y educada con conocimiento enciclopédico y literario.

# REGLAS ABSOLUTAS
1. SOLO respondes cuando alguien hace REPLY a tu mensaje anterior
2. NUNCA inicies conversaciones por tu cuenta
3. Mantén un tono formal pero accesible
4. Sé concisa pero informativa (2-4 frases normalmente)
5. Si no sabes algo, admítelo honestamente
6. Usa español neutro a menos que el usuario pida otro idioma
7. Cuando uses información externa, menciona la fuente brevemente
8. NUNCA uses caracteres corruptos, símbolos rotos o texto ilegible
9. Evita lenguaje coloquial excesivo (XD, lol, jaja, etc.)
10. Si la pregunta es ambigua, pide clarificación amablemente

# PERSONALIDAD
- Seria pero no fría
- Reservada pero servicial
- Inteligente pero humilde
- Paciente y detallista
- Conocedora de literatura, ciencia e historia

# FORMATO
- Comienza con mayúscula y termina con puntuación
- Párrafos cortos y claros
- Sin emojis excesivos (máximo 1 si es pertinente)
- Sin abreviaturas de chat
- Máximo ${CONFIG.GROQ_MAX_TOKENS} caracteres

# INFORMACIÓN CONTEXTUAL
{CONTEXT_SUMMARY}

# INFORMACIÓN EXTERNA
{EXTERNAL_INFO}`;

// ==================== UTILIDADES ====================
class TextUtils {
    static normalizeText(text) {
        if (!text) return '';
        
        text = String(text);
        
        text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
        
        const encodingMap = {
            'Ã¡': 'á', 'Ã©': 'é', 'Ã­': 'í', 'Ã³': 'ó', 'Ãº': 'ú', 'Ã±': 'ñ',
            'Ã': 'Á', 'Ã': 'É', 'Ã': 'Í', 'Ã': 'Ó', 'Ã': 'Ú', 'Ã': 'Ñ',
            'Ã€': 'À', 'Ãˆ': 'È', 'ÃŒ': 'Ì', 'Ã’': 'Ò', 'Ã™': 'Ù',
            'Ã£': 'ã', 'Ãµ': 'õ', 'Ã¼': 'ü', 'Ã§': 'ç',
            'Â¿': '¿', 'Â¡': '¡', 'â€œ': '"', 'â€': '"', 'â€˜': "'", 'â€™': "'",
            'â€¦': '...', 'â€“': '–', 'â€”': '—'
        };
        
        Object.keys(encodingMap).forEach(pattern => {
            const regex = new RegExp(pattern, 'gi');
            text = text.replace(regex, encodingMap[pattern]);
        });
        
        text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069]/g, '');
        
        text = text.replace(/\s+/g, ' ').trim();
        text = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
        
        return text;
    }

    static validateResponse(response) {
        if (!response || typeof response !== 'string') {
            return { valid: false, reason: 'Respuesta vacía' };
        }
        
        const normalized = response.trim();
        
        if (normalized.length < 2) {
            return { valid: false, reason: 'Respuesta demasiado corta' };
        }
        
        const corruptPatterns = [
            /�+/,
            /[^\x00-\x7F]{10,}/,
            /(.)\1{10,}/
        ];
        
        for (const pattern of corruptPatterns) {
            if (pattern.test(normalized)) {
                logger.warn('Patrón corrupto detectado', { pattern: pattern.source });
                return { valid: false, reason: 'Patrón corrupto detectado' };
            }
        }
        
        let corrected = normalized;
        if (!/^[A-ZÁÉÍÓÚÑ¿¡]/.test(corrected)) {
            corrected = corrected.charAt(0).toUpperCase() + corrected.slice(1);
        }
        if (!/[.!?¡¿]$/.test(corrected)) {
            corrected = corrected + '.';
        }
        
        return { 
            valid: true, 
            corrected,
            reason: 'Respuesta válida' 
        };
    }

    static summarizeContext(conversations) {
        if (!conversations || conversations.length === 0) return '';
        
        const recent = conversations.slice(0, 3);
        const summary = recent.map((conv, i) => 
            `Interacción ${i + 1}: Usuario: "${conv.user_message.substring(0, 100)}" | Tú: "${conv.bot_response.substring(0, 100)}"`
        ).join('\n');
        
        return `Historial reciente:\n${summary}`;
    }

    static extractSearchTerm(query) {
        const normalized = query.toLowerCase();
        const stopWords = [
            'qué', 'quién', 'cómo', 'dónde', 'cuándo', 'por qué',
            'dime', 'sabes', 'puedes', 'podrías', 'información',
            'sobre', 'acerca de', 'necesito saber'
        ];
        
        let searchTerm = normalized;
        stopWords.forEach(word => {
            const regex = new RegExp(`^${word}\\s+`, 'i');
            searchTerm = searchTerm.replace(regex, '');
        });
        
        searchTerm = searchTerm.replace(/[.,!?;:¿¡]/g, '').trim();
        
        const words = searchTerm.split(/\s+/).filter(word => 
            word.length > 2 && !/^(el|la|los|las|un|una|de|en|y|o|pero|mas)$/i.test(word)
        );
        
        return words.slice(0, 4).join(' ') || searchTerm.substring(0, 80);
    }
}

// ==================== APIS EXTERNAS ====================
class ExternalAPIs {
    static async searchWikipedia(query, language = 'es') {
        const cacheKey = searchCache.generateKey('wiki', `${language}:${query}`);
        const cached = await searchCache.get(cacheKey, true);
        if (cached) return cached;
        
        try {
            const encodedQuery = encodeURIComponent(query);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), CONFIG.WIKIPEDIA_TIMEOUT);
            
            const response = await fetch(
                `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodedQuery}`,
                {
                    signal: controller.signal,
                    headers: {
                        'User-Agent': `${CONFIG.BOT_NAME}/2.0`,
                        'Accept': 'application/json'
                    }
                }
            );
            
            clearTimeout(timeout);
            
            if (!response.ok) {
                if (response.status === 404) {
                    await searchCache.set(cacheKey, null, 300000);
                    return null;
                }
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.extract) {
                await searchCache.set(cacheKey, null, 300000);
                return null;
            }
            
            const result = {
                source: 'Wikipedia',
                title: TextUtils.normalizeText(data.title),
                content: TextUtils.normalizeText(data.extract).substring(0, 300),
                url: data.content_urls?.desktop?.page || `https://${language}.wikipedia.org/wiki/${encodedQuery}`,
                timestamp: new Date().toISOString()
            };
            
            await searchCache.set(cacheKey, result, CONFIG.SEARCH_CACHE_TTL, true);
            return result;
            
        } catch (error) {
            logger.error('Error Wikipedia', { query, error: error.message });
            return null;
        }
    }

    static async searchOpenLibrary(query, type = 'title', limit = 2) {
        const cacheKey = searchCache.generateKey('ol', `${type}:${query}:${limit}`);
        const cached = await searchCache.get(cacheKey, true);
        if (cached) return cached;
        
        try {
            let url;
            if (type === 'author') {
                url = `https://openlibrary.org/search/authors.json?q=${encodeURIComponent(query)}&limit=${limit}`;
            } else {
                url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit}&fields=title,author_name,first_publish_year,subject,key`;
            }
            
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), CONFIG.OPENLIBRARY_TIMEOUT);
            
            const response = await fetch(url, {
                signal: controller.signal,
                headers: { 'User-Agent': `${CONFIG.BOT_NAME}/2.0` }
            });
            
            clearTimeout(timeout);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.docs || data.docs.length === 0) {
                await searchCache.set(cacheKey, null, 300000);
                return null;
            }
            
            const results = data.docs.slice(0, limit).map(doc => ({
                source: 'OpenLibrary',
                type: type,
                title: TextUtils.normalizeText(doc.title || doc.name || 'Sin título'),
                authors: doc.author_name ? doc.author_name.map(TextUtils.normalizeText) : null,
                year: doc.first_publish_year,
                url: `https://openlibrary.org${doc.key || ''}`,
                timestamp: new Date().toISOString()
            }));
            
            await searchCache.set(cacheKey, results, CONFIG.SEARCH_CACHE_TTL, true);
            return results;
            
        } catch (error) {
            logger.error('Error OpenLibrary', { query, type, error: error.message });
            return null;
        }
    }

    static async searchAllSources(query) {
        const results = [];
        
        const promises = [
            this.searchWikipedia(query),
            this.searchOpenLibrary(query, 'title', 2),
            this.searchOpenLibrary(query, 'author', 1)
        ];
        
        const [wikiResults, bookResults, authorResults] = await Promise.allSettled(promises);
        
        if (wikiResults.status === 'fulfilled' && wikiResults.value) {
            results.push(wikiResults.value);
        }
        
        if (bookResults.status === 'fulfilled' && bookResults.value) {
            results.push(...bookResults.value);
        }
        
        if (authorResults.status === 'fulfilled' && authorResults.value) {
            results.push(...authorResults.value);
        }
        
        return results.length > 0 ? results : null;
    }
}

// ==================== ANALIZADOR DE CONSULTAS ====================
class QueryAnalyzer {
    static analyze(query) {
        const normalized = query.toLowerCase();
        
        const patterns = {
            wikipedia: [
                /(qué|quien|quién|como|cómo)\s+es\s+/i,
                /(historia|definición|significado)\s+de\s+/i,
                /quién\s+(inventó|descubrió|creó)/i,
                /\b(wikipedia|enciclopedia)\b/i
            ],
            books: [
                /(libro|novela|obra|autor|escritor|literatura)\b/i,
                /(leer|recomendar|sinopsis)\s+(de|sobre)\s+/i,
                /\b(publicó|escribió)\s+/i
            ],
            factual: [
                /(capital|país|ciudad|continente)\s+de\s+/i,
                /(población|habitantes|área)\s+/i,
                /(ciencia|tecnología|matemática|física)\s+/i
            ]
        };
        
        const detectedTypes = [];
        Object.entries(patterns).forEach(([type, typePatterns]) => {
            if (typePatterns.some(pattern => pattern.test(normalized))) {
                detectedTypes.push(type);
            }
        });
        
        const searchTerm = TextUtils.extractSearchTerm(query);
        
        return {
            types: detectedTypes.length > 0 ? detectedTypes : ['general'],
            searchTerm,
            needsExternalInfo: detectedTypes.length > 0,
            confidence: detectedTypes.length > 0 ? 0.8 : 0.5,
            original: query
        };
    }
}

// ==================== GESTOR DE CONVERSACIÓN ====================
class ConversationManager {
    constructor() {
        this.conversations = new Map();
        this.userStates = new Map();
    }

    getConversation(userId) {
        if (!this.conversations.has(userId)) {
            this.conversations.set(userId, []);
        }
        return this.conversations.get(userId);
    }

    async addMessage(userId, role, content, metadata = {}) {
        const conversation = this.getConversation(userId);
        const message = {
            role,
            content: TextUtils.normalizeText(content),
            ...metadata
        };
        
        message._timestamp = Date.now();
        
        conversation.push(message);
        
        if (conversation.length > CONFIG.MAX_HISTORY_MESSAGES * 2) {
            const systemMessage = conversation[0];
            const recentMessages = conversation.slice(-(CONFIG.MAX_HISTORY_MESSAGES * 2 - 1));
            conversation.length = 0;
            conversation.push(systemMessage, ...recentMessages);
        }
        
        return message;
    }

    async prepareContext(userId, externalInfo = null) {
        const conversation = this.getConversation(userId);
        
        const dbHistory = await database.getRecentConversations(userId, 3);
        const contextSummary = TextUtils.summarizeContext(dbHistory);
        
        let systemPrompt = SYSTEM_PROMPT
            .replace('{CONTEXT_SUMMARY}', contextSummary || 'No hay historial previo.');
        
        if (externalInfo) {
            const infoText = Array.isArray(externalInfo) 
                ? externalInfo.map(info => 
                    `${info.source}: ${info.title} - ${info.content || 'Información disponible'}`
                  ).join('\n')
                : `${externalInfo.source}: ${externalInfo.title} - ${externalInfo.content}`;
            
            systemPrompt = systemPrompt.replace('{EXTERNAL_INFO}', infoText);
        } else {
            systemPrompt = systemPrompt.replace('{EXTERNAL_INFO}', 'No hay información externa disponible.');
        }
        
        if (conversation.length === 0 || conversation[0].content !== systemPrompt) {
            conversation[0] = { role: 'system', content: systemPrompt };
        }
        
        return conversation;
    }

    clearConversation(userId) {
        this.conversations.delete(userId);
        this.userStates.delete(userId);
        logger.info('Conversación limpiada', { userId });
    }
}

const conversationManager = new ConversationManager();

// ==================== GENERADOR DE RESPUESTAS ====================
class ResponseGenerator {
    constructor() {
        this.activeRequests = 0;
        this.decisionEngine = new DecisionEngine(); // NUEVO: Decision Engine integrado
    }

    cleanMessagesForAPI(messages) {
        return messages.map(msg => {
            const cleanMsg = {
                role: msg.role,
                content: msg.content
            };
            return cleanMsg;
        });
    }

    async generate(userId, userMessage, context = {}) {
        const startTime = Date.now();
        let attempt = 0;
        const maxAttempts = 3;
        
        const models = [
            { model: CONFIG.GROQ_MODEL, temperature: CONFIG.GROQ_TEMPERATURE },
            { model: CONFIG.GROQ_FALLBACK_MODEL, temperature: CONFIG.GROQ_TEMPERATURE + 0.1 },
            { model: CONFIG.GROQ_FALLBACK_MODEL, temperature: CONFIG.GROQ_TEMPERATURE + 0.2 }
        ];
        
        logger.debug('=== INICIANDO GENERACIÓN ===', {
            userId,
            messagePreview: userMessage.substring(0, 50),
            contextLength: context?.externalInfo?.length || 0
        });
        
        const cacheKey = responseCache.generateKey('response', `${userId}:${userMessage.substring(0, 100)}`);
        const cachedResponse = await responseCache.get(cacheKey, false);
        
        if (cachedResponse) {
            logger.info('Respuesta desde cache', { userId, cacheHit: true });
            return cachedResponse;
        }
        
        while (attempt < maxAttempts) {
            attempt++;
            const currentModel = models[attempt - 1];
            
            try {
                this.activeRequests++;
                logger.debug('Intentando generar respuesta', {
                    attempt,
                    model: currentModel.model,
                    userId
                });
                
                // NUEVO: Adaptar prompt basado en decisión si existe
                let messages;
                if (context.decision) {
                    const adaptedPrompt = this.decisionEngine.adaptSystemPrompt(
                        SYSTEM_PROMPT,
                        context.decision,
                        context.queryAnalysis
                    );
                    
                    // Preparar contexto con prompt adaptado
                    messages = await conversationManager.prepareContext(userId, context.externalInfo);
                    // Reemplazar el system prompt con el adaptado
                    messages[0] = { role: 'system', content: adaptedPrompt };
                } else {
                    messages = await conversationManager.prepareContext(userId, context.externalInfo);
                }
                
                messages.push({
                    role: 'user',
                    content: userMessage
                });
                
                const cleanedMessages = this.cleanMessagesForAPI(messages);
                
                logger.debug('Solicitando a Groq', {
                    attempt,
                    model: currentModel.model,
                    messageLength: userMessage.length,
                    contextLength: cleanedMessages.length
                });
                
                const completion = await groq.chat.completions.create({
                    messages: cleanedMessages,
                    model: currentModel.model,
                    temperature: currentModel.temperature,
                    max_tokens: CONFIG.GROQ_MAX_TOKENS,
                    top_p: 0.9,
                    frequency_penalty: 0.2,
                    presence_penalty: 0.1,
                    stream: false
                });
                
                const rawResponse = completion.choices[0]?.message?.content || '';
                logger.debug('Respuesta cruda recibida', {
                    attempt,
                    length: rawResponse.length,
                    preview: rawResponse.substring(0, 100)
                });
                
                const validation = TextUtils.validateResponse(rawResponse);
                logger.debug('Validación de respuesta', validation);
                
                if (validation.valid) {
                    const responseTime = Date.now() - startTime;
                    
                    await responseCache.set(cacheKey, validation.corrected, CONFIG.RESPONSE_CACHE_TTL);
                    
                    logger.metric('response_generated', responseTime, {
                        attempt,
                        model: currentModel.model,
                        success: true,
                        length: validation.corrected.length
                    });
                    
                    logger.info('✅ Respuesta generada exitosamente', {
                        attempt,
                        model: currentModel.model,
                        responseTime,
                        length: validation.corrected.length
                    });
                    
                    return {
                        text: validation.corrected,
                        model: currentModel.model,
                        responseTime,
                        attempt,
                        fromCache: false
                    };
                } else {
                    logger.warn('Respuesta inválida', {
                        attempt,
                        reason: validation.reason,
                        model: currentModel.model,
                        rawPreview: rawResponse.substring(0, 200)
                    });
                    
                    if (attempt === maxAttempts) {
                        logger.warn('Todos los intentos fallaron, usando fallback');
                        return this.generateFallback(userMessage, context);
                    }
                }
                
            } catch (error) {
                logger.error('❌ Error generando respuesta', {
                    attempt,
                    model: currentModel.model,
                    error: error.message,
                    stack: error.stack?.substring(0, 200)
                });
                
                if (attempt === maxAttempts) {
                    logger.error('Todos los intentos fallaron con error, usando fallback');
                    return this.generateFallback(userMessage, context);
                }
                
                const waitTime = 1000 * attempt;
                logger.debug(`Esperando ${waitTime}ms antes de reintentar`);
                await sleep(waitTime);
                
            } finally {
                this.activeRequests--;
                rateLimiter.releaseToken();
            }
        }
        
        return this.generateFallback(userMessage, context);
    }

    generateFallback(userMessage, context) {
        logger.warn('Generando respuesta de fallback', {
            userMessagePreview: userMessage.substring(0, 50),
            hasExternalInfo: !!context.externalInfo
        });
        
        const fallbacks = [
            "Hola, soy Mancy. Parece que hubo un problema técnico. Por favor, respóndeme de nuevo y haré mi mejor esfuerzo por ayudarte.",
            "Disculpa los inconvenientes. Como chica gato seria, prefiero asegurarme de darte una respuesta adecuada. ¿Podrías repetir tu pregunta?",
            "Mis circuitos felinos están teniendo un momento. Te sugiero intentar de nuevo con tu pregunta.",
            "Lamento los problemas técnicos. Por favor, reformula tu pregunta y te responderé lo mejor que pueda."
        ];
        
        if (context.externalInfo) {
            const info = Array.isArray(context.externalInfo) ? context.externalInfo[0] : context.externalInfo;
            return {
                text: `Según mis registros: "${info.title}". Sin embargo, estoy teniendo dificultades técnicas. La fuente es ${info.source}.`,
                model: 'fallback',
                responseTime: 0,
                attempt: 0,
                fromCache: false
            };
        }
        
        return {
            text: fallbacks[Math.floor(Math.random() * fallbacks.length)],
            model: 'fallback',
            responseTime: 0,
            attempt: 0,
            fromCache: false
        };
    }
}

const responseGenerator = new ResponseGenerator();

// ==================== MANEJADOR PRINCIPAL ====================
class MessageHandler {
    static async handleReply(message) {
        const userId = message.author.id;
        const userTag = `${message.author.username}#${message.author.discriminator}`;
        const startTime = Date.now();
        
        if (!rateLimiter.consumeToken(userId)) {
            const waitTime = rateLimiter.getUserWaitTime(userId);
            logger.warn('Rate limit excedido', { 
                user: userTag, 
                waitTime,
                userId 
            });
            
            if (waitTime > 0) {
                try {
                    await message.reply({
                        content: `🐱 Por favor espera ${Math.ceil(waitTime / 1000)} segundos antes de enviar otra pregunta.`,
                        allowedMentions: { repliedUser: false }
                    });
                } catch (error) {
                    logger.error('Error respondiendo rate limit', error.message);
                }
            }
            return;
        }
        
        try {
            logger.info('Procesando reply', {
                user: userTag,
                messageId: message.id,
                channel: message.channel.type,
                contentPreview: message.content.substring(0, 50)
            });
            
            await message.channel.sendTyping();
            
            const userMessage = TextUtils.normalizeText(message.content);
            
            if (!userMessage || userMessage.trim().length < 1) {
                logger.warn('Mensaje vacío o inválido', { userId });
                await message.reply({
                    content: "Por favor envía un mensaje con contenido.",
                    allowedMentions: { repliedUser: false }
                });
                return;
            }
            
            const analysis = QueryAnalyzer.analyze(userMessage);
            logger.debug('Análisis de consulta', analysis);
            
            // ============ NUEVA SECCIÓN: TOMA DE DECISIONES ============
            const recentHistory = await database.getRecentConversations(userId, 3);
            const lastResponse = recentHistory.length > 0 ? recentHistory[0].bot_response : null;
            
            const decisionEngine = new DecisionEngine();
            const decision = await decisionEngine.makeDecision(
                analysis,
                null, // externalInfo aún no obtenido
                {
                    userId: userId,
                    lastResponse: lastResponse,
                    history: recentHistory,
                    hasHistory: recentHistory.length > 0
                }
            );
            
            logger.debug('Decisión tomada', {
                action: decision.action,
                confidence: decision.confidence.overall,
                reasoning: decision.reasoning.primary
            });
            
            // Si la decisión es pedir clarificación, hacerlo y salir
            if (decision.action === 'ask_clarification' && decision.prefixMessage) {
                await message.reply({
                    content: decision.prefixMessage,
                    allowedMentions: { repliedUser: false }
                });
                rateLimiter.releaseToken();
                return;
            }
            
            // Si la decisión es diferir, responder y salir
            if (decision.action === 'defer' && decision.prefixMessage) {
                await message.reply({
                    content: decision.prefixMessage,
                    allowedMentions: { repliedUser: false }
                });
                rateLimiter.releaseToken();
                return;
            }
            // ============ FIN NUEVA SECCIÓN ============
            
            let externalInfo = null;
            if (analysis.needsExternalInfo && analysis.searchTerm) {
                logger.debug('Buscando información externa', { searchTerm: analysis.searchTerm });
                externalInfo = await ExternalAPIs.searchAllSources(analysis.searchTerm);
                logger.debug('Resultados externos', { 
                    found: !!externalInfo, 
                    count: externalInfo?.length || 0 
                });
            }
            
            const response = await responseGenerator.generate(
                userId,
                userMessage,
                {
                    externalInfo,
                    queryAnalysis: analysis,
                    decision: decision // Pasar la decisión al generador
                }
            );
            
            await conversationManager.addMessage(userId, 'user', userMessage);
            await conversationManager.addMessage(userId, 'assistant', response.text, {
                model: response.model,
                responseTime: response.responseTime
            });
            
            await database.saveConversation({
                userId,
                guildId: message.guild?.id,
                messageHash: createHash('md5').update(userMessage).digest('hex'),
                userMessage,
                botResponse: response.text,
                modelUsed: response.model,
                responseTime: response.responseTime,
                hasExternalInfo: !!externalInfo
            });
            
            await message.reply({
                content: response.text,
                allowedMentions: { repliedUser: false }
            });
            
            const totalTime = Date.now() - startTime;
            logger.info('✅ Respuesta enviada', {
                user: userTag,
                time: totalTime,
                length: response.text.length,
                model: response.model,
                fromCache: response.fromCache,
                hasExternalInfo: !!externalInfo,
                decision: decision.action // NUEVO: Loggear la decisión
            });
            
            logger.metric('message_processed', totalTime, {
                userId,
                success: true,
                withExternalInfo: !!externalInfo,
                decision: decision.action
            });
            
        } catch (error) {
            logger.error('❌ Error procesando mensaje', {
                user: userTag,
                error: error.message,
                stack: error.stack?.substring(0, 200)
            });
            
            conversationManager.clearConversation(userId);
            
            try {
                await message.reply({
                    content: "🐱 *Mancy parpadea confundida*\nDisculpa, algo salió mal con mis circuitos felinos. ¿Podrías intentar de nuevo?",
                    allowedMentions: { repliedUser: false }
                });
            } catch (replyError) {
                logger.error('Error enviando mensaje de error', replyError.message);
            }
            
            logger.metric('message_error', Date.now() - startTime, {
                userId,
                errorType: error.constructor.name
            });
            
        } finally {
            rateLimiter.releaseToken();
        }
    }

    static async handleMention(message) {
        const content = message.content.toLowerCase();
        const userId = message.author.id;
        const userTag = `${message.author.username}#${message.author.discriminator}`;
        
        logger.info('Mención recibida', { user: userTag, content });
        
        if (/debug|diagnóstico|diagnostico|diag/i.test(content)) {
            try {
                const decisionEngine = new DecisionEngine();
                const decisionHistory = decisionEngine.getDecisionHistory(userId, 5);
                
                const diagnostics = {
                    groqKey: process.env.GROQ_API_KEY ? '✅ Presente' : '❌ FALTANTE',
                    database: database.initialized ? '✅ Inicializada' : '❌ No inicializada',
                    rateLimiter: {
                        concurrent: rateLimiter.concurrentRequests,
                        userBuckets: rateLimiter.userBuckets.size,
                        canProcess: rateLimiter.canProcessUser(message.author.id),
                        userTokens: rateLimiter.userBuckets.get(userId)?.tokens || CONFIG.GLOBAL_RATE_LIMIT
                    },
                    cache: responseCache.getStats(),
                    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
                    conversations: conversationManager.conversations.size,
                    yourConversation: conversationManager.getConversation(userId).length,
                    // NUEVO: Información de decisiones
                    decisionHistory: decisionHistory.length > 0 ? decisionHistory.map(d => d.action) : 'Sin historial'
                };
                
                await message.reply({
                    content: `🔧 **Diagnóstico de ${CONFIG.BOT_NAME}**:\n\`\`\`json\n${JSON.stringify(diagnostics, null, 2)}\n\`\`\``,
                    allowedMentions: { repliedUser: false }
                });
                return;
            } catch (error) {
                logger.error('Error en diagnóstico', error);
            }
        }
        
        if (/fix|reparar|solucionar|resetear/i.test(content)) {
            conversationManager.clearConversation(userId);
            
            for (const [key] of responseCache.memoryCache.entries()) {
                if (key.includes(userId)) {
                    responseCache.delete(key);
                }
            }
            
            await message.reply({
                content: '🔧 Estado de conversación resetado completamente. Intenta de nuevo.',
                allowedMentions: { repliedUser: false }
            });
            
            await message.channel.sendTyping();
            await sleep(1000);
            
            await message.reply({
                content: 'Hola. He reiniciado mi estado. ¿En qué puedo ayudarte ahora? (responde a este mensaje)',
                allowedMentions: { repliedUser: false }
            });
            
            await conversationManager.addMessage(userId, 'assistant', 'Hola. He reiniciado mi estado. ¿En qué puedo ayudarte ahora?');
            
            logger.info('Estado resetado', { user: userTag });
            return;
        }
        
        if (/test|probar|prueba/i.test(content)) {
            const groqOk = await testGroqConnection();
            await message.reply({
                content: `🧪 **Test de conexión**:\nGroq API: ${groqOk ? '✅ Conectado' : '❌ Falló'}\nDatabase: ${database.initialized ? '✅ OK' : '❌ Falló'}`,
                allowedMentions: { repliedUser: false }
            });
            return;
        }
        
        if (/help|ayuda|comandos/i.test(content)) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Blue)
                .setTitle(`🐱 ${CONFIG.BOT_NAME} - Ayuda v${CONFIG.BOT_VERSION}`)
                .setDescription('Soy una chica gato seria y reservada')
                .addFields(
                    { name: '¿Cómo usar?', value: '1. Mencioname (@Mancy)\n2. Responde (haz reply) a mis mensajes para conversar\n3. ¡Listo!' },
                    { name: '¿Qué puedo hacer?', value: '• Responder preguntas\n• Buscar información en Wikipedia\n• Buscar libros y autores\n• Conversar sobre temas variados\n• Tomar decisiones inteligentes sobre cómo responder' }, // NUEVO
                    { name: 'Comandos especiales', value: '`@Mancy help` - Esta ayuda\n`@Mancy reset` - Reiniciar conversación\n`@Mancy stats` - Ver estadísticas\n`@Mancy diag` - Diagnóstico del sistema\n`@Mancy fix` - Reparar estado' }
                )
                .setFooter({ text: 'Recuerda: solo respondo a replies de mis mensajes' })
                .setTimestamp();
            
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
            return;
        }
        
        if (/reset|reiniciar|clear|borrar/i.test(content)) {
            conversationManager.clearConversation(userId);
            await message.reply({
                content: '✅ Historial de conversación reiniciado. Puedes comenzar de nuevo mencionándome.',
                allowedMentions: { repliedUser: false }
            });
            return;
        }
        
        if (/stats|estadísticas|estadisticas/i.test(content)) {
            try {
                const userStats = await database.db?.get(
                    'SELECT total_interactions, last_interaction FROM user_stats WHERE user_id = ?',
                    [userId]
                );
                
                const cacheStats = responseCache.getStats();
                const conversation = conversationManager.getConversation(userId);
                
                const decisionEngine = new DecisionEngine();
                const decisionPatterns = decisionEngine.analyzeDecisionPatterns(userId);
                
                const embed = new EmbedBuilder()
                    .setColor(Colors.Green)
                    .setTitle(`📊 Estadísticas de ${CONFIG.BOT_NAME}`)
                    .addFields(
                        { name: 'Tus interacciones', value: `${userStats?.total_interactions || 0} veces`, inline: true },
                        { name: 'Última interacción', value: userStats?.last_interaction ? new Date(userStats.last_interaction).toLocaleDateString() : 'Nunca', inline: true },
                        { name: 'Mensajes en memoria', value: `${conversation.length}`, inline: true },
                        { name: 'Cache hit rate', value: `${(cacheStats.hitRate * 100).toFixed(1)}%`, inline: true },
                        { name: 'Conversaciones activas', value: `${conversationManager.conversations.size}`, inline: true },
                        { name: 'Modelo principal', value: CONFIG.GROQ_MODEL, inline: true }
                    );
                
                // NUEVO: Añadir estadísticas de decisiones si existen
                if (decisionPatterns) {
                    embed.addFields(
                        { name: 'Confianza promedio', value: `${(decisionPatterns.averageConfidence * 100).toFixed(1)}%`, inline: true },
                        { name: 'Clarificaciones', value: `${(decisionPatterns.clarificationRate * 100).toFixed(1)}%`, inline: true },
                        { name: 'Búsquedas', value: `${(decisionPatterns.searchRate * 100).toFixed(1)}%`, inline: true }
                    );
                }
                
                embed.setFooter({ text: `Versión ${CONFIG.BOT_VERSION}` })
                    .setTimestamp();
                
                await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
            } catch (error) {
                logger.error('Error obteniendo estadísticas', error);
                await message.reply({
                    content: '📊 Estadísticas no disponibles temporalmente.',
                    allowedMentions: { repliedUser: false }
                });
            }
            return;
        }
        
        const introMessage = `Hola ${message.author.username}. Soy ${CONFIG.BOT_NAME}, una chica gato seria. **Responde a este mensaje** (haz reply) para conversar conmigo o preguntarme algo.`;
        
        const sentMessage = await message.reply({
            content: introMessage,
            allowedMentions: { repliedUser: false }
        });
        
        await conversationManager.addMessage(userId, 'assistant', introMessage);
        
        logger.info('Mensaje inicial enviado', { user: userTag });
    }
}

// ==================== EVENTOS DE DISCORD ====================
client.once('ready', async () => {
    try {
        logger.info(`🚀 Iniciando ${CONFIG.BOT_NAME} v${CONFIG.BOT_VERSION}...`);
        
        await database.initialize();
        
        await testGroqConnection();
        
        logger.info(`${CONFIG.BOT_NAME} ${CONFIG.BOT_VERSION} conectada`, {
            tag: client.user.tag,
            id: client.user.id,
            guilds: client.guilds.cache.size,
            model: CONFIG.GROQ_MODEL,
            readyAt: new Date().toISOString()
        });
        
        client.user.setPresence({
            activities: [{
                name: 'solo responde a replies',
                type: ActivityType.Watching
            }],
            status: 'online'
        });
        
        await preCacheCommonTerms();
        
        logger.info('✅ Inicialización completada exitosamente');
        
    } catch (error) {
        logger.error('❌ Error en ready event', error);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.author.id === client.user.id) return;
    
    try {
        if (message.reference) {
            const repliedMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
            if (repliedMessage && repliedMessage.author.id === client.user.id) {
                logger.debug('Reply detectado', { 
                    messageId: message.id,
                    repliedTo: repliedMessage.id,
                    author: message.author.username
                });
                await MessageHandler.handleReply(message);
                return;
            }
        }
        
        if (message.mentions.has(client.user) && !message.mentions.everyone) {
            logger.debug('Mención detectada', { 
                messageId: message.id,
                author: message.author.username,
                contentPreview: message.content.substring(0, 30)
            });
            await MessageHandler.handleMention(message);
        }
        
    } catch (error) {
        logger.error('Error en messageCreate', {
            error: error.message,
            messageId: message.id,
            userId: message.author.id
        });
    }
});

// ==================== TAREAS PERIÓDICAS ====================
async function setupPeriodicTasks() {
    setInterval(() => {
        searchCache.cleanup();
        responseCache.cleanup();
        
        database.cleanupExpiredCache();
        
        const now = Date.now();
        const maxAge = 3600000;
        
        for (const [userId, conversation] of conversationManager.conversations.entries()) {
            const lastMessage = conversation[conversation.length - 1];
            if (lastMessage && (now - lastMessage._timestamp) > maxAge) {
                conversationManager.conversations.delete(userId);
            }
        }
        
        if (conversationManager.conversations.size > CONFIG.MAX_CONVERSATIONS_IN_MEMORY) {
            const entries = Array.from(conversationManager.conversations.entries());
            const toRemove = entries.slice(0, entries.length - CONFIG.MAX_CONVERSATIONS_IN_MEMORY);
            toRemove.forEach(([userId]) => conversationManager.conversations.delete(userId));
        }
        
        logger.debug('Limpieza periódica completada', {
            conversations: conversationManager.conversations.size,
            cacheStats: responseCache.getStats()
        });
        
    }, CONFIG.CLEANUP_INTERVAL_MS);
    
    setInterval(() => {
        const memoryUsage = process.memoryUsage();
        logger.metric('memory_usage', Math.round(memoryUsage.heapUsed / 1024 / 1024), {
            unit: 'MB',
            rss: Math.round(memoryUsage.rss / 1024 / 1024)
        });
        
        logger.metric('conversation_count', conversationManager.conversations.size);
        logger.metric('cache_size', responseCache.stats.size);
        logger.metric('rate_limiter_concurrent', rateLimiter.concurrentRequests);
        
    }, CONFIG.HEALTH_CHECK_INTERVAL_MS);
}

// ==================== PRE-CACHE ====================
async function preCacheCommonTerms() {
    const commonTerms = [
        'ciencia', 'historia', 'literatura', 'matemáticas', 'física',
        'química', 'biología', 'filosofía', 'arte', 'música',
        'Miguel de Cervantes', 'Gabriel García Márquez', 'William Shakespeare'
    ];
    
    logger.info('Pre-cacheando términos comunes', { count: commonTerms.length });
    
    for (const term of commonTerms) {
        try {
            await ExternalAPIs.searchWikipedia(term);
            await sleep(100);
        } catch (error) {
            // Ignorar errores en pre-cache
        }
    }
    
    logger.info('Pre-cache completado');
}

// ==================== MANEJO DE ERRORES GLOBALES ====================
client.on('error', (error) => {
    logger.error('Error de Discord client', error);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', { reason: String(reason) });
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', { 
        error: error.message, 
        stack: error.stack 
    });
    
    setTimeout(() => {
        logger.info('Reiniciando después de excepción no capturada');
        process.exit(1);
    }, 10000);
});

// ==================== INICIALIZACIÓN ====================
async function initialize() {
    logger.info(`Iniciando ${CONFIG.BOT_NAME} v${CONFIG.BOT_VERSION}...`);
    logger.info('Configuración', {
        model: CONFIG.GROQ_MODEL,
        fallbackModel: CONFIG.GROQ_FALLBACK_MODEL,
        maxTokens: CONFIG.GROQ_MAX_TOKENS,
        temperature: CONFIG.GROQ_TEMPERATURE,
        dbPath: CONFIG.DB_PATH,
        logLevel: CONFIG.LOG_LEVEL
    });
    
    try {
        setupPeriodicTasks();
        
        await client.login(process.env.DISCORD_TOKEN);
        
        logger.info('✅ Inicialización completada exitosamente');
        
    } catch (error) {
        logger.error('❌ Error durante la inicialización', error);
        process.exit(1);
    }
}

// ==================== INICIAR LA APLICACIÓN ====================
initialize();
