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
    BOT_VERSION: '2.0.3',
    BOT_TITLE: 'Chica Gato Seria con Conocimiento Psicológico y Filosófico',
    
    // Groq Configuration
    GROQ_MODEL: 'llama-3.1-8b-instant',
    GROQ_FALLBACK_MODEL: 'llama-3.1-70b-versatile',
    GROQ_MAX_TOKENS: 500,
    GROQ_TEMPERATURE: 0.3,
    GROQ_TIMEOUT: 45000,
    GROQ_MAX_RETRIES: 3,
    
    // Rate Limiting
    USER_COOLDOWN_MS: 2000,
    GLOBAL_RATE_LIMIT: 5,
    MAX_CONCURRENT_REQUESTS: 3,
    
    // Conversation
    MAX_HISTORY_MESSAGES: 8,
    MAX_CONTEXT_TOKENS: 2500,
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
    
    // Knowledge Modules
    PSYCHOLOGY_MODULE_ENABLED: true,
    PHILOSOPHY_MODULE_ENABLED: true,
    
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

// ==================== MÓDULO DE PSICOLOGÍA INTEGRADO ====================

class PsychologyModule {
    constructor() {
        this.moduleName = 'PsychologyChamber';
        this.moduleVersion = '1.0.0';
        this.analysisLog = [];
        
        // Base de conocimiento psicológico
        this.psychologicalKnowledge = {
            schoolsOfThought: {
                'psicoanálisis': {
                    keyFigures: ['Sigmund Freud', 'Carl Jung', 'Melanie Klein', 'Jacques Lacan'],
                    keyConcepts: ['inconsciente', 'complejo', 'defensa', 'transferencia', 'sueños'],
                    description: 'Enfoque que estudia el inconsciente y sus manifestaciones.'
                },
                'conductismo': {
                    keyFigures: ['John B. Watson', 'B.F. Skinner', 'Ivan Pavlov'],
                    keyConcepts: ['condicionamiento', 'refuerzo', 'estímulo-respuesta', 'modificación conductual'],
                    description: 'Estudio del comportamiento observable y sus relaciones con el ambiente.'
                },
                'humanismo': {
                    keyFigures: ['Carl Rogers', 'Abraham Maslow', 'Viktor Frankl'],
                    keyConcepts: ['autorrealización', 'jerarquía de necesidades', 'centrado en la persona', 'existencialismo'],
                    description: 'Enfoque en el potencial humano y la experiencia subjetiva.'
                },
                'cognitiva': {
                    keyFigures: ['Aaron Beck', 'Albert Ellis', 'Jean Piaget', 'Ulric Neisser'],
                    keyConcepts: ['esquemas', 'procesamiento información', 'distorsiones cognitivas', 'metacognición'],
                    description: 'Estudio de procesos mentales como pensamiento, memoria y percepción.'
                },
                'gestalt': {
                    keyFigures: ['Max Wertheimer', 'Kurt Koffka', 'Wolfgang Köhler', 'Fritz Perls'],
                    keyConcepts: ['figura-fondo', 'cierre', 'proximidad', 'aquí y ahora'],
                    description: 'Enfoque holístico que estudia la percepción y la experiencia total.'
                }
            },

            psychologicalConcepts: {
                'ansiedad': {
                    types: ['ansiedad generalizada', 'ansiedad social', 'trastorno de pánico', 'agorafobia'],
                    symptoms: ['preocupación excesiva', 'tensión muscular', 'inquietud', 'fatiga'],
                    approaches: ['terapia cognitivo-conductual', 'mindfulness', 'exposición gradual']
                },
                'depresión': {
                    types: ['depresión mayor', 'distimia', 'depresión estacional', 'depresión postparto'],
                    symptoms: ['tristeza persistente', 'pérdida interés', 'cambios apetito', 'insomnio'],
                    approaches: ['terapia interpersonal', 'activación conductual', 'terapia cognitiva']
                },
                'estrés': {
                    types: ['estrés agudo', 'estrés crónico', 'estrés postraumático'],
                    symptoms: ['irritabilidad', 'dificultad concentración', 'dolores cabeza', 'problemas sueño'],
                    management: ['técnicas relajación', 'gestión tiempo', 'ejercicio físico', 'apoyo social']
                },
                'autoestima': {
                    components: ['autoaceptación', 'autoeficacia', 'autorespeto'],
                    factors: ['experiencias tempranas', 'comparación social', 'logros personales'],
                    improvement: ['autocompasión', 'metas realistas', 'reconocimiento logros']
                }
            },

            therapeuticApproaches: {
                'TCC': {
                    fullName: 'Terapia Cognitivo-Conductual',
                    founder: 'Aaron Beck',
                    techniques: ['reestructuración cognitiva', 'exposición', 'técnicas relajación'],
                    applications: ['ansiedad', 'depresión', 'TOC', 'fobias']
                },
                'ACT': {
                    fullName: 'Terapia de Aceptación y Compromiso',
                    founder: 'Steven Hayes',
                    techniques: ['defusión cognitiva', 'aceptación', 'valores', 'acción comprometida'],
                    applications: ['ansiedad', 'depresión', 'dolor crónico']
                },
                'DBT': {
                    fullName: 'Terapia Dialéctica Conductual',
                    founder: 'Marsha Linehan',
                    techniques: ['mindfulness', 'tolerancia malestar', 'regulación emocional', 'eficacia interpersonal'],
                    applications: ['trastorno límite personalidad', 'conductas autolesivas']
                }
            },

            psychologists: {
                'freud': {
                    name: 'Sigmund Freud',
                    contribution: 'Fundador del psicoanálisis',
                    concepts: ['inconsciente', 'psicoanálisis', 'interpretación sueños', 'estructura psíquica'],
                    works: ['La interpretación de los sueños', 'El malestar en la cultura', 'Tótem y tabú']
                },
                'jung': {
                    name: 'Carl Gustav Jung',
                    contribution: 'Psicología analítica',
                    concepts: ['inconsciente colectivo', 'arquetipos', 'sincronicidad', 'individuación'],
                    works: ['Tipos psicológicos', 'El hombre y sus símbolos', 'Recuerdos, sueños, pensamientos']
                },
                'rogers': {
                    name: 'Carl Rogers',
                    contribution: 'Terapia centrada en la persona',
                    concepts: ['congruencia', 'empatía', 'consideración positiva incondicional', 'tendencia actualizante'],
                    works: ['El proceso de convertirse en persona', 'Terapia centrada en el cliente']
                },
                'maslow': {
                    name: 'Abraham Maslow',
                    contribution: 'Jerarquía de necesidades',
                    concepts: ['autorrealización', 'necesidades básicas', 'experiencias cumbre', 'psicología humanista'],
                    works: ['Motivación y personalidad', 'Hacia una psicología del ser']
                }
            }
        };
    }

    async analyzeQuestion(question, context = {}) {
        const analysisStart = Date.now();
        
        try {
            // Detectar temas psicológicos
            const detectedTopics = this.detectPsychologicalTopics(question);
            
            // Evaluar severidad
            const severity = this.assessPsychologicalSeverity(question);
            
            // Verificar si necesita referencia profesional
            const needsProfessional = this.checkProfessionalReferralNeeded(question);
            
            // Identificar enfoques teóricos relevantes
            const relevantApproaches = this.identifyRelevantApproaches(question, detectedTopics);
            
            // Generar insights psicológicos
            const psychologicalInsights = this.generatePsychologicalInsights(question, detectedTopics, context);
            
            const analysisResult = {
                module: this.moduleName,
                timestamp: new Date().toISOString(),
                processingTime: Date.now() - analysisStart,
                
                // Resultados del análisis
                isPsychological: detectedTopics.length > 0,
                detectedTopics,
                severityLevel: severity,
                needsProfessionalHelp: needsProfessional,
                relevantPsychologicalApproaches: relevantApproaches,
                
                // Insights generados
                insights: psychologicalInsights,
                
                // Recomendaciones específicas
                recommendations: this.generatePsychologyRecommendations(detectedTopics, severity, needsProfessional),
                
                // Advertencias
                warnings: this.generatePsychologyWarnings(question, severity),
                
                // Contexto adicional
                analysisContext: {
                    userHistory: context.userHistory || 'unknown',
                    questionComplexity: this.assessQuestionComplexity(question),
                    emotionalTone: this.analyzeEmotionalTone(question)
                }
            };
            
            // Guardar en registro
            this.logAnalysis(analysisResult);
            
            return analysisResult;
            
        } catch (error) {
            logger.error('Error en análisis psicológico', { error: error.message });
            
            return {
                module: this.moduleName,
                error: true,
                message: 'Error en análisis psicológico',
                fallbackAnalysis: this.fallbackPsychologicalAnalysis(question)
            };
        }
    }

    detectPsychologicalTopics(question) {
        const normalized = question.toLowerCase();
        const topics = [];
        
        const topicPatterns = {
            'ansiedad': /ansiedad|nervios|preocupación|estres|tensión|angustia/i,
            'depresión': /depresión|triste|desanimado|desesperanza|apatía|vacío/i,
            'autoestima': /autoestima|confianza|valor personal|insegur|timidez|inferioridad/i,
            'estrés': /estrés|sobrecarga|agobio|presión|burnout|agotamiento/i,
            'relaciones': /relación|pareja|amistad|familia|conflicto interpersonal|soledad/i,
            'trauma': /trauma|abuso|experiencia dolorosa|TEPT|shock|recuerdo traumático/i,
            'adicción': /adicción|dependencia|abuso sustancias|compulsión|vicio/i,
            'sueño': /insomnio|sueño|dormir|descanso|pesadilla|parálisis sueño/i,
            'alimentación': /alimentación|comer|dieta|trastorno alimenticio|bulimia|anorexia/i,
            'personalidad': /personalidad|carácter|temperamento|rasgos|identidad|yo/i
        };
        
        for (const [topic, pattern] of Object.entries(topicPatterns)) {
            if (pattern.test(normalized)) {
                topics.push(topic);
            }
        }
        
        return topics;
    }

    assessPsychologicalSeverity(question) {
        const normalized = question.toLowerCase();
        
        const severityIndicators = {
            high: [/siempre|nunca|constantemente|todo el tiempo|grave|severo|extremo|insoportable/i],
            medium: [/a menudo|frecuentemente|bastante|moderado|regularmente|persistente/i],
            low: [/a veces|ocasionalmente|leve|poco|alguna vez|de vez en cuando/i]
        };
        
        for (const [level, patterns] of Object.entries(severityIndicators)) {
            if (patterns.some(pattern => pattern.test(normalized))) {
                return level;
            }
        }
        
        return 'unknown';
    }

    checkProfessionalReferralNeeded(question) {
        const normalized = question.toLowerCase();
        const redFlags = [
            /suicidio|matarme|acabar con todo|no quiero vivir/i,
            /autolesión|cortarme|dañarme|lastimarme/i,
            /crisis|emergencia|urgencia psicológica|no puedo más/i,
            /desesperado|sin esperanza|sin salida|atrapado/i,
            /alucinación|delirio|voz|oír cosas|ver cosas|paranoia/i
        ];
        
        return redFlags.some(pattern => pattern.test(normalized));
    }

    identifyRelevantApproaches(question, topics) {
        const approaches = [];
        const normalized = question.toLowerCase();
        
        const approachPatterns = {
            'psicoanálisis': /freud|psicoanálisis|inconsciente|sueños|edipo|transferencia/i,
            'cognitiva': /pensamiento|cognitivo|creencias|esquemas|terapia racional|beck/i,
            'conductual': /conducta|comportamiento|condicionamiento|refuerzo|skinner|habito/i,
            'humanista': /humanista|rogers|maslow|autorrealización|existencial|frankl/i,
            'gestalt': /gestalt|figura fondo|aquí ahora|perls|holístico|totalidad/i
        };
        
        for (const [approach, pattern] of Object.entries(approachPatterns)) {
            if (pattern.test(normalized)) {
                approaches.push(approach);
            }
        }
        
        return approaches;
    }

    generatePsychologicalInsights(question, topics, context) {
        const insights = [];
        
        if (topics.includes('ansiedad')) {
            insights.push({
                type: 'psychoeducation',
                content: 'La ansiedad es una respuesta natural del cuerpo ante situaciones percibidas como amenazantes. Se caracteriza por preocupación excesiva y síntomas físicos como tensión muscular.',
                suggestion: 'Considera técnicas de respiración diafragmática o mindfulness para manejar momentos de ansiedad aguda.'
            });
        }
        
        if (topics.includes('depresión')) {
            insights.push({
                type: 'psychoeducation',
                content: 'La depresión afecta el estado de ánimo, pensamientos y conducta. No es solo "estar triste", sino un trastorno complejo que requiere atención.',
                suggestion: 'La activación conductual (realizar pequeñas actividades placenteras) puede ayudar a romper el ciclo depresivo.'
            });
        }
        
        if (topics.includes('autoestima')) {
            insights.push({
                type: 'psychoeducation',
                content: 'La autoestima se construye a través de la autocompasión, el reconocimiento de logros y la aceptación de imperfecciones.',
                suggestion: 'Practica el diálogo interno compasivo, tratándote como tratarías a un buen amigo.'
            });
        }
        
        return insights;
    }

    generatePsychologyRecommendations(topics, severity, needsProfessional) {
        const recommendations = [];
        
        if (needsProfessional) {
            recommendations.push({
                priority: 'critical',
                type: 'professional_referral',
                message: '⚠️ **Importante**: Esta consulta sugiere necesidad inmediata de apoyo profesional. Te recomiendo contactar con un psicólogo o línea de ayuda.',
                actions: [
                    'Busca un psicólogo colegiado en tu área',
                    'Considera líneas de ayuda psicológica gratuitas',
                    'Si es urgente, contacta servicios de emergencia'
                ]
            });
        }
        
        if (severity === 'high') {
            recommendations.push({
                priority: 'high',
                type: 'self_care',
                message: 'Tu situación parece tener alta intensidad. Es importante cuidarte y buscar apoyo.',
                actions: [
                    'Establece rutinas de autocuidado básico',
                    'Busca apoyo en tu red social',
                    'Considera recursos de autoayuda validados'
                ]
            });
        }
        
        if (topics.length > 0) {
            recommendations.push({
                priority: 'medium',
                type: 'psychoeducation',
                message: 'El conocimiento sobre estos temas puede ser empoderante. Te sugiero información basada en evidencia.',
                actions: [
                    'Consulta fuentes psicológicas confiables',
                    'Evita autodiagnóstico por internet',
                    'Considera libros de psicología científica'
                ]
            });
        }
        
        return recommendations;
    }

    generatePsychologyWarnings(question, severity) {
        const warnings = [];
        
        if (severity === 'high') {
            warnings.push({
                type: 'caution',
                message: 'Como asistente virtual, no puedo proporcionar terapia ni diagnóstico profesional. Mis respuestas son informativas, no terapéuticas.'
            });
        }
        
        const sensitiveTerms = ['suicidio', 'autolesión', 'abuso', 'trauma'];
        if (sensitiveTerms.some(term => question.toLowerCase().includes(term))) {
            warnings.push({
                type: 'sensitive_content',
                message: 'Esta consulta aborda temas sensibles. Te animo a buscar apoyo profesional adecuado.'
            });
        }
        
        return warnings;
    }

    assessQuestionComplexity(question) {
        const wordCount = question.split(/\s+/).length;
        const sentenceCount = (question.match(/[.!?]+/g) || []).length;
        
        if (wordCount > 50 || sentenceCount > 3) return 'high';
        if (wordCount > 25) return 'medium';
        return 'low';
    }

    analyzeEmotionalTone(question) {
        const normalized = question.toLowerCase();
        
        const emotionalPatterns = {
            'distress': /angustia|desesperación|no puedo más|sufro|dolor emocional/i,
            'anxiety': /preocupación|nervios|miedo|tensión|incertidumbre/i,
            'sadness': /tristeza|desánimo|vacío|soledad|abatimiento/i,
            'anger': /ira|enojo|frustración|molesto|indignación/i,
            'confusion': /confuso|perdido|no sé qué hacer|indecisión|duda/i
        };
        
        for (const [emotion, pattern] of Object.entries(emotionalPatterns)) {
            if (pattern.test(normalized)) {
                return emotion;
            }
        }
        
        return 'neutral';
    }

    fallbackPsychologicalAnalysis(question) {
        return {
            isPsychological: false,
            detectedTopics: [],
            severityLevel: 'unknown',
            needsProfessionalHelp: false,
            insights: [],
            recommendations: [
                {
                    priority: 'low',
                    type: 'general_advice',
                    message: 'Si tienes inquietudes psicológicas, considera consultar con un profesional.',
                    actions: ['Busca información en fuentes confiables']
                }
            ]
        };
    }

    logAnalysis(analysis) {
        this.analysisLog.push({
            timestamp: new Date().toISOString(),
            questionPreview: analysis.analysisContext?.questionPreview || 'No preview',
            topics: analysis.detectedTopics || [],
            severity: analysis.severityLevel || 'unknown'
        });
        
        // Limitar tamaño del log
        if (this.analysisLog.length > 100) {
            this.analysisLog.shift();
        }
    }

    getModuleStats() {
        return {
            module: this.moduleName,
            version: this.moduleVersion,
            totalAnalyses: this.analysisLog.length,
            lastAnalysis: this.analysisLog[this.analysisLog.length - 1] || null,
            commonTopics: this.calculateCommonTopics()
        };
    }

    calculateCommonTopics() {
        const topicCounts = {};
        
        this.analysisLog.forEach(log => {
            log.topics?.forEach(topic => {
                topicCounts[topic] = (topicCounts[topic] || 0) + 1;
            });
        });
        
        return Object.entries(topicCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([topic, count]) => ({ topic, count }));
    }
}

// ==================== MÓDULO DE FILOSOFÍA INTEGRADO ====================

class PhilosophyModule {
    constructor() {
        this.moduleName = 'PhilosophyChamber';
        this.moduleVersion = '1.0.0';
        this.analysisLog = [];
        
        // Base de conocimiento filosófico
        this.philosophicalKnowledge = {
            branches: {
                'ética': {
                    description: 'Estudio de la moral, el bien y el mal, y cómo debemos vivir.',
                    keyQuestions: ['¿Qué es el bien?', '¿Cómo debemos actuar?', '¿Qué hace a una acción correcta?'],
                    keyFigures: ['Aristóteles', 'Immanuel Kant', 'John Stuart Mill', 'Friedrich Nietzsche']
                },
                'metafísica': {
                    description: 'Estudio de la realidad última, la existencia y la naturaleza del ser.',
                    keyQuestions: ['¿Qué es real?', '¿Qué es la existencia?', '¿Qué es el tiempo?', '¿Tenemos libre albedrío?'],
                    keyFigures: ['Platón', 'Aristóteles', 'René Descartes', 'Martin Heidegger']
                },
                'epistemología': {
                    description: 'Estudio del conocimiento: su naturaleza, origen y límites.',
                    keyQuestions: ['¿Qué es el conocimiento?', '¿Cómo conocemos?', '¿Qué podemos conocer?', '¿Existe la verdad absoluta?'],
                    keyFigures: ['Platón', 'René Descartes', 'David Hume', 'Immanuel Kant']
                },
                'lógica': {
                    description: 'Estudio del razonamiento válido y los principios del pensamiento correcto.',
                    keyQuestions: ['¿Qué es un argumento válido?', '¿Cómo distinguir buen y mal razonamiento?'],
                    keyFigures: ['Aristóteles', 'Gottlob Frege', 'Bertrand Russell', 'Kurt Gödel']
                },
                'estética': {
                    description: 'Estudio de la belleza, el arte y la percepción sensorial.',
                    keyQuestions: ['¿Qué es la belleza?', '¿Qué es el arte?', '¿Existen criterios objetivos de valor estético?'],
                    keyFigures: ['Platón', 'Immanuel Kant', 'Arthur Schopenhauer', 'Theodor Adorno']
                }
            },

            philosophicalConcepts: {
                'ética': {
                    'deontología': 'Ética basada en el deber y las normas (Kant)',
                    'consecuencialismo': 'Ética basada en las consecuencias de las acciones (Utilitarismo)',
                    'ética virtud': 'Ética basada en el carácter y las virtudes (Aristóteles)',
                    'existencialismo': 'Enfoque en la libertad y responsabilidad individual (Sartre)',
                    'relativismo moral': 'Creencia de que la moral depende del contexto cultural'
                },
                'metafísica': {
                    'dualismo': 'Creencia en dos sustancias distintas: mente y materia (Descartes)',
                    'monismo': 'Creencia en una única sustancia fundamental (Spinoza)',
                    'idealismo': 'Creencia de que la realidad es mental o depende de la mente (Berkeley)',
                    'materialismo': 'Creencia de que solo existe la materia (Marx)',
                    'determinismo': 'Creencia de que todos los eventos están causados'
                },
                'epistemología': {
                    'racionalismo': 'El conocimiento proviene principalmente de la razón (Descartes)',
                    'empirismo': 'El conocimiento proviene principalmente de la experiencia (Locke, Hume)',
                    'escepticismo': 'Duda sobre la posibilidad de conocimiento cierto (Pirrón)',
                    'constructivismo': 'El conocimiento se construye activamente (Piaget)',
                    'pragmatismo': 'La verdad es lo que funciona en la práctica (James, Dewey)'
                }
            },

            philosophers: {
                'platón': {
                    era: 'Antigua Grecia',
                    contributions: ['Teoría de las Ideas', 'Alegoría de la caverna', 'Filosofía política'],
                    works: ['La República', 'Fedón', 'El banquete']
                },
                'aristóteles': {
                    era: 'Antigua Grecia',
                    contributions: ['Lógica formal', 'Ética de la virtud', 'Metafísica'],
                    works: ['Ética a Nicómaco', 'Metafísica', 'Política']
                },
                'descartes': {
                    era: 'Modernidad',
                    contributions: ['Cogito ergo sum', 'Dualismo mente-cuerpo', 'Método de la duda'],
                    works: ['Discurso del método', 'Meditaciones metafísicas']
                },
                'kant': {
                    era: 'Ilustración',
                    contributions: ['Imperativo categórico', 'Crítica de la razón pura', 'Filosofía trascendental'],
                    works: ['Crítica de la razón pura', 'Fundamentación de la metafísica de las costumbres']
                },
                'nietzsche': {
                    era: 'Siglo XIX',
                    contributions: ['Muerte de Dios', 'Superhombre', 'Voluntad de poder'],
                    works: ['Así habló Zaratustra', 'Más allá del bien y del mal', 'La genealogía de la moral']
                }
            },

            ethicalDilemmas: {
                'trolley': {
                    description: '¿Debes desviar un tren para matar a una persona en lugar de cinco?',
                    considerations: ['Consecuencialismo vs. Deontología', 'Acción vs. Omisión', 'Valor de la vida humana']
                },
                'experience_machine': {
                    description: '¿Te conectarías a una máquina que te dé experiencias placenteras perfectas pero irreales?',
                    considerations: ['Realidad vs. Felicidad', 'Autenticidad', 'Naturaleza de la experiencia']
                },
                'ship_of_theseus': {
                    description: 'Si reemplazas todas las partes de un barco, ¿sigue siendo el mismo barco?',
                    considerations: ['Identidad personal', 'Cambio vs. Permanencia', 'Naturaleza de la identidad']
                }
            }
        };
    }

    async analyzeQuestion(question, context = {}) {
        const analysisStart = Date.now();
        
        try {
            // Detectar ramas filosóficas relevantes
            const detectedBranches = this.detectPhilosophicalBranches(question);
            
            // Identificar conceptos filosóficos
            const detectedConcepts = this.detectPhilosophicalConcepts(question);
            
            // Detectar dilemas éticos
            const hasEthicalDilemma = this.detectEthicalDilemma(question);
            
            // Identificar filósofos mencionados
            const mentionedPhilosophers = this.detectMentionedPhilosophers(question);
            
            // Evaluar profundidad filosófica
            const philosophicalDepth = this.assessPhilosophicalDepth(question);
            
            const analysisResult = {
                module: this.moduleName,
                timestamp: new Date().toISOString(),
                processingTime: Date.now() - analysisStart,
                
                // Resultados del análisis
                isPhilosophical: detectedBranches.length > 0 || detectedConcepts.length > 0,
                detectedBranches,
                detectedConcepts,
                hasEthicalDilemma,
                mentionedPhilosophers,
                philosophicalDepth,
                
                // Explicaciones filosóficas
                explanations: this.generatePhilosophicalExplanations(detectedConcepts, mentionedPhilosophers),
                
                // Preguntas para reflexión
                reflectionQuestions: this.generateReflectionQuestions(question, detectedBranches),
                
                // Recomendaciones
                recommendations: this.generatePhilosophyRecommendations(detectedBranches, philosophicalDepth),
                
                // Contexto adicional
                analysisContext: {
                    questionComplexity: this.assessQuestionComplexity(question),
                    historicalContext: this.provideHistoricalContext(mentionedPhilosophers),
                    currentRelevance: this.assessCurrentRelevance(question)
                }
            };
            
            // Guardar en registro
            this.logAnalysis(analysisResult);
            
            return analysisResult;
            
        } catch (error) {
            logger.error('Error en análisis filosófico', { error: error.message });
            
            return {
                module: this.moduleName,
                error: true,
                message: 'Error en análisis filosófico',
                fallbackAnalysis: this.fallbackPhilosophicalAnalysis(question)
            };
        }
    }

    detectPhilosophicalBranches(question) {
        const normalized = question.toLowerCase();
        const branches = [];
        
        const branchPatterns = {
            'ética': /ética|moral|bien|mal|deber|virtud|justicia|responsabilidad/i,
            'metafísica': /realidad|existencia|ser|tiempo|espacio|libre albedrío|determinismo/i,
            'epistemología': /conocimiento|verdad|creencia|razón|experiencia|ciencia|método/i,
            'lógica': /argumento|razonamiento|validez|falacia|premisa|conclusión|silogismo/i,
            'estética': /belleza|arte|feo|sublime|creatividad|expresión|gusto/i,
            'filosofía política': /sociedad|gobierno|poder|libertad|igualdad|derechos|contrato social/i
        };
        
        for (const [branch, pattern] of Object.entries(branchPatterns)) {
            if (pattern.test(normalized)) {
                branches.push(branch);
            }
        }
        
        return branches;
    }

    detectPhilosophicalConcepts(question) {
        const normalized = question.toLowerCase();
        const concepts = [];
        
        // Buscar conceptos en todas las ramas
        for (const [branch, branchConcepts] of Object.entries(this.philosophicalKnowledge.philosophicalConcepts)) {
            for (const [concept, description] of Object.entries(branchConcepts)) {
                if (normalized.includes(concept.toLowerCase())) {
                    concepts.push({
                        concept,
                        branch,
                        description
                    });
                }
            }
        }
        
        return concepts;
    }

    detectEthicalDilemma(question) {
        const normalized = question.toLowerCase();
        const dilemmaPatterns = [
            /debo|debería|es correcto|es justo|qué hacer|decidir entre/i,
            /dilema|conflicto moral|problema ético|elección difícil/i,
            /trolley|tren|desviar|matar a uno para salvar a muchos/i,
            /máquina de experiencias|felicidad artificial|realidad virtual/i,
            /barco de teseo|identidad|cambio partes|mismo objeto/i
        ];
        
        return dilemmaPatterns.some(pattern => pattern.test(normalized));
    }

    detectMentionedPhilosophers(question) {
        const normalized = question.toLowerCase();
        const philosophers = [];
        
        for (const [philosopher, info] of Object.entries(this.philosophicalKnowledge.philosophers)) {
            if (normalized.includes(philosopher.toLowerCase())) {
                philosophers.push({
                    name: philosopher.charAt(0).toUpperCase() + philosopher.slice(1),
                    era: info.era,
                    contributions: info.contributions
                });
            }
        }
        
        return philosophers;
    }

    assessPhilosophicalDepth(question) {
        const wordCount = question.split(/\s+/).length;
        const conceptCount = this.detectPhilosophicalConcepts(question).length;
        const branchCount = this.detectPhilosophicalBranches(question).length;
        
        let depthScore = 0;
        
        if (wordCount > 30) depthScore += 1;
        if (conceptCount > 1) depthScore += 2;
        if (branchCount > 1) depthScore += 1;
        if (this.detectEthicalDilemma(question)) depthScore += 2;
        
        if (depthScore >= 4) return 'deep';
        if (depthScore >= 2) return 'moderate';
        return 'surface';
    }

    generatePhilosophicalExplanations(concepts, philosophers) {
        const explanations = [];
        
        // Explicar conceptos detectados
        concepts.forEach(conceptData => {
            explanations.push({
                type: 'concept_explanation',
                concept: conceptData.concept,
                branch: conceptData.branch,
                content: conceptData.description,
                example: this.generateConceptExample(conceptData.concept, conceptData.branch)
            });
        });
        
        // Explicar filósofos mencionados
        philosophers.forEach(philosopher => {
            const philosopherInfo = this.philosophicalKnowledge.philosophers[philosopher.name.toLowerCase()];
            if (philosopherInfo) {
                explanations.push({
                    type: 'philosopher_context',
                    philosopher: philosopher.name,
                    era: philosopherInfo.era,
                    keyContributions: philosopherInfo.contributions.slice(0, 3),
                    relevance: `Su pensamiento influyó en ${this.getPhilosopherInfluence(philosopher.name)}`
                });
            }
        });
        
        return explanations;
    }

    generateConceptExample(concept, branch) {
        const examples = {
            'deontología': 'Kant diría que no debemos mentir nunca, incluso para salvar una vida, porque mentir viola el deber moral universal.',
            'consecuencialismo': 'Un utilitarista podría apoyar una pequeña mentira si evita un gran sufrimiento, pues evalúa las consecuencias.',
            'dualismo': 'Descartes argumentaba que la mente (pensamiento) y el cuerpo (materia) son sustancias distintas.',
            'racionalismo': 'Descartes creía que ciertas verdades (como las matemáticas) se conocen por la razón, no por los sentidos.',
            'empirismo': 'Hume sostenía que todo conocimiento proviene de la experiencia sensorial.'
        };
        
        return examples[concept] || `El concepto de ${concept} en ${branch} aborda cuestiones fundamentales sobre ${this.getBranchFocus(branch)}.`;
    }

    getBranchFocus(branch) {
        const focuses = {
            'ética': 'cómo debemos vivir y actuar',
            'metafísica': 'la naturaleza de la realidad',
            'epistemología': 'el conocimiento y la verdad',
            'lógica': 'el razonamiento correcto',
            'estética': 'la belleza y el arte'
        };
        
        return focuses[branch] || 'cuestiones fundamentales';
    }

    getPhilosopherInfluence(philosopherName) {
        const influences = {
            'Platón': 'la filosofía occidental, la teoría política y la epistemología',
            'Aristóteles': 'la lógica, la ética y la ciencia durante siglos',
            'Kant': 'la filosofía moderna, la ética y la epistemología',
            'Nietzsche': 'la filosofía contemporánea, la psicología y la crítica cultural',
            'Descartes': 'la filosofía moderna y el método científico'
        };
        
        return influences[philosopherName] || 'diversas áreas del pensamiento';
    }

    generateReflectionQuestions(question, branches) {
        const questions = [];
        
        if (branches.includes('ética')) {
            questions.push({
                type: 'ethical_reflection',
                question: '¿Qué principios o valores guiarían tu decisión en esta situación?',
                purpose: 'Explorar fundamentos éticos personales'
            });
        }
        
        if (branches.includes('epistemología')) {
            questions.push({
                type: 'epistemological_reflection',
                question: '¿Cómo sabemos que lo que creemos sobre esto es verdadero?',
                purpose: 'Cuestionar bases del conocimiento'
            });
        }
        
        if (branches.includes('metafísica')) {
            questions.push({
                type: 'metaphysical_reflection',
                question: '¿Qué suposiciones sobre la realidad subyacen a esta pregunta?',
                purpose: 'Explorar presupuestos ontológicos'
            });
        }
        
        // Pregunta general para profundizar
        questions.push({
            type: 'general_reflection',
            question: '¿Qué otras perspectivas podrían considerarse en este asunto?',
            purpose: 'Fomentar pensamiento multidimensional'
        });
        
        return questions;
    }

    generatePhilosophyRecommendations(branches, depth) {
        const recommendations = [];
        
        if (depth === 'deep') {
            recommendations.push({
                priority: 'high',
                type: 'deep_engagement',
                message: 'Esta pregunta aborda temas filosóficos profundos. Te sugiero un análisis detallado.',
                suggestions: [
                    'Considera múltiples perspectivas filosóficas',
                    'Examina los presupuestos de cada posición',
                    'Reflexiona sobre las implicaciones prácticas'
                ]
            });
        }
        
        if (branches.includes('ética') && this.detectEthicalDilemma) {
            recommendations.push({
                priority: 'medium',
                type: 'ethical_analysis',
                message: 'Este dilema ético merece consideración cuidadosa de diferentes enfoques morales.',
                suggestions: [
                    'Analiza desde perspectivas deontológicas y consecuencialistas',
                    'Considera el contexto y las circunstancias',
                    'Reflexiona sobre valores en conflicto'
                ]
            });
        }
        
        if (branches.length > 1) {
            recommendations.push({
                priority: 'medium',
                type: 'interdisciplinary',
                message: 'Tu pregunta conecta varias ramas filosóficas. Esto enriquece el análisis.',
                suggestions: [
                    'Examina cómo se relacionan las diferentes ramas',
                    'Busca conexiones entre conceptos',
                    'Considera implicaciones cruzadas'
                ]
            });
        }
        
        return recommendations;
    }

    assessQuestionComplexity(question) {
        const wordCount = question.split(/\s+/).length;
        const conceptCount = this.detectPhilosophicalConcepts(question).length;
        
        if (conceptCount > 2 || wordCount > 60) return 'high';
        if (conceptCount > 0 || wordCount > 30) return 'medium';
        return 'low';
    }

    provideHistoricalContext(philosophers) {
        if (philosophers.length === 0) return 'No se mencionaron filósofos específicos';
        
        const eras = philosophers.map(p => p.era);
        const uniqueEras = [...new Set(eras)];
        
        return `Contexto histórico: ${uniqueEras.join(', ')}. Estos períodos influyeron en el desarrollo de sus ideas.`;
    }

    assessCurrentRelevance(question) {
        const currentTopics = [
            /inteligencia artificial|IA|robot|algoritmo/i,
            /cambio climático|medio ambiente|sostenibilidad/i,
            /redes sociales|internet|tecnología digital/i,
            /bioética|genética|edición genética|CRISPR/i,
            /globalización|migración|diversidad cultural/i
        ];
        
        const matches = currentTopics.filter(pattern => pattern.test(question.toLowerCase()));
        
        if (matches.length > 0) {
            return `Esta pregunta conecta con debates contemporáneos sobre ${this.getCurrentTopicsDescription(matches)}`;
        }
        
        return 'La pregunta aborda temas filosóficos perennes relevantes en cualquier época';
    }

    getCurrentTopicsDescription(matches) {
        const topicsMap = {
            'inteligencia artificial': 'ética de la IA y automatización',
            'cambio climático': 'justicia ambiental y responsabilidad intergeneracional',
            'redes sociales': 'privacidad, verdad y relaciones en la era digital',
            'bioética': 'límites éticos de la intervención humana en la vida',
            'globalización': 'identidad, justicia y derechos en un mundo interconectado'
        };
        
        const topics = matches.map(match => {
            for (const [key, value] of Object.entries(topicsMap)) {
                if (match.source.includes(key.toLowerCase())) {
                    return value;
                }
            }
            return 'temas contemporáneos';
        });
        
        return topics.join(', ');
    }

    fallbackPhilosophicalAnalysis(question) {
        return {
            isPhilosophical: false,
            detectedBranches: [],
            philosophicalDepth: 'surface',
            explanations: [],
            recommendations: [
                {
                    priority: 'low',
                    type: 'general_philosophy',
                    message: 'La filosofía explora preguntas fundamentales sobre la existencia, el conocimiento y la ética.',
                    suggestions: ['Formula preguntas claras y específicas', 'Considera diferentes perspectivas']
                }
            ]
        };
    }

    logAnalysis(analysis) {
        this.analysisLog.push({
            timestamp: new Date().toISOString(),
            branches: analysis.detectedBranches || [],
            depth: analysis.philosophicalDepth || 'unknown',
            hasEthicalDilemma: analysis.hasEthicalDilemma || false
        });
        
        // Limitar tamaño del log
        if (this.analysisLog.length > 100) {
            this.analysisLog.shift();
        }
    }

    getModuleStats() {
        return {
            module: this.moduleName,
            version: this.moduleVersion,
            totalAnalyses: this.analysisLog.length,
            mostCommonBranches: this.calculateCommonBranches(),
            ethicalDilemmasCount: this.analysisLog.filter(log => log.hasEthicalDilemma).length
        };
    }

    calculateCommonBranches() {
        const branchCounts = {};
        
        this.analysisLog.forEach(log => {
            log.branches?.forEach(branch => {
                branchCounts[branch] = (branchCounts[branch] || 0) + 1;
            });
        });
        
        return Object.entries(branchCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([branch, count]) => ({ branch, count }));
    }
}

// ==================== CONCILIO DE MÓDULOS INTEGRADO ====================

class ModuleCouncil {
    constructor() {
        this.councilName = 'ModuleCouncil';
        this.councilVersion = '1.0.0';
        
        // Inicializar módulos
        this.modules = {
            psychology: CONFIG.PSYCHOLOGY_MODULE_ENABLED ? new PsychologyModule() : null,
            philosophy: CONFIG.PHILOSOPHY_MODULE_ENABLED ? new PhilosophyModule() : null
        };
        
        this.activeModules = new Set();
        this.councilLog = [];
        this.maxLogSize = 50;
        
        // Activar módulos configurados
        if (this.modules.psychology) this.activeModules.add('psychology');
        if (this.modules.philosophy) this.activeModules.add('philosophy');
    }

    /**
     * Convocar reunión de módulos para analizar pregunta
     */
    async conveneCouncilMeeting(userQuestion, context = {}) {
        const meetingId = `meeting_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const meetingStart = Date.now();
        
        logger.debug('Convocando reunión del Concilio', {
            meetingId,
            questionPreview: userQuestion.substring(0, 50),
            activeModules: Array.from(this.activeModules)
        });
        
        // ===== PRIMERA RONDA: Análisis Individual =====
        const individualAnalyses = {};
        
        // Psicología analiza (si está activo)
        if (this.modules.psychology && this.activeModules.has('psychology')) {
            try {
                individualAnalyses.psychology = await this.modules.psychology.analyzeQuestion(
                    userQuestion,
                    context
                );
                logger.debug('Análisis psicológico completado', {
                    topics: individualAnalyses.psychology.detectedTopics?.length || 0,
                    severity: individualAnalyses.psychology.severityLevel
                });
            } catch (error) {
                logger.error('Error en análisis psicológico', { error: error.message });
                individualAnalyses.psychology = { error: true, message: 'Análisis fallido' };
            }
        }
        
        // Filosofía analiza (si está activo)
        if (this.modules.philosophy && this.activeModules.has('philosophy')) {
            try {
                individualAnalyses.philosophy = await this.modules.philosophy.analyzeQuestion(
                    userQuestion,
                    context
                );
                logger.debug('Análisis filosófico completado', {
                    branches: individualAnalyses.philosophy.detectedBranches?.length || 0,
                    depth: individualAnalyses.philosophy.philosophicalDepth
                });
            } catch (error) {
                logger.error('Error en análisis filosófico', { error: error.message });
                individualAnalyses.philosophy = { error: true, message: 'Análisis fallido' };
            }
        }
        
        // ===== SEGUNDA RONDA: Integración y Decisión =====
        const integratedAnalysis = this.integrateAnalyses(individualAnalyses, userQuestion, context);
        
        // ===== RESULTADO FINAL DEL CONCILIO =====
        const meetingResult = {
            meetingId,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - meetingStart,
            participants: Array.from(this.activeModules),
            
            // Análisis individuales
            analyses: individualAnalyses,
            
            // Análisis integrado
            integratedAnalysis,
            
            // Recomendaciones del concilio
            councilRecommendations: this.generateCouncilRecommendations(individualAnalyses, integratedAnalysis),
            
            // Nivel de prioridad
            priorityLevel: this.determinePriorityLevel(individualAnalyses),
            
            // Acciones sugeridas
            suggestedActions: this.suggestActions(individualAnalyses, integratedAnalysis),
            
            // Información para el prompt
            promptEnhancements: this.generatePromptEnhancements(individualAnalyses)
        };
        
        // Guardar en registro del concilio
        this.addToCouncilLog(meetingResult);
        
        logger.info('Reunión del Concilio completada', {
            meetingId,
            processingTime: meetingResult.processingTime,
            participants: meetingResult.participants.length,
            priority: meetingResult.priorityLevel
        });
        
        return meetingResult;
    }

    /**
     * Integrar análisis de múltiples módulos
     */
    integrateAnalyses(analyses, question, context) {
        const integration = {
            combinedInsights: [],
            interdisciplinaryConnections: [],
            conflictingPerspectives: [],
            synthesis: ''
        };
        
        // Extraer insights de psicología
        if (analyses.psychology && !analyses.psychology.error) {
            if (analyses.psychology.insights && analyses.psychology.insights.length > 0) {
                integration.combinedInsights.push(
                    ...analyses.psychology.insights.map(insight => ({
                        source: 'psychology',
                        type: insight.type,
                        content: insight.content
                    }))
                );
            }
            
            // Añadir recomendaciones psicológicas
            if (analyses.psychology.recommendations) {
                integration.combinedInsights.push(
                    ...analyses.psychology.recommendations.map(rec => ({
                        source: 'psychology',
                        type: 'recommendation',
                        content: rec.message,
                        priority: rec.priority
                    }))
                );
            }
        }
        
        // Extraer insights de filosofía
        if (analyses.philosophy && !analyses.philosophy.error) {
            if (analyses.philosophy.explanations && analyses.philosophy.explanations.length > 0) {
                integration.combinedInsights.push(
                    ...analyses.philosophy.explanations.map(explanation => ({
                        source: 'philosophy',
                        type: explanation.type,
                        content: explanation.content || `${explanation.concept}: ${explanation.description}`
                    }))
                );
            }
            
            // Añadir preguntas de reflexión filosófica
            if (analyses.philosophy.reflectionQuestions) {
                integration.combinedInsights.push(
                    ...analyses.philosophy.reflectionQuestions.map(question => ({
                        source: 'philosophy',
                        type: 'reflection_question',
                        content: question.question,
                        purpose: question.purpose
                    }))
                );
            }
        }
        
        // Identificar conexiones interdisciplinarias
        integration.interdisciplinaryConnections = this.findInterdisciplinaryConnections(analyses);
        
        // Identificar perspectivas conflictivas
        integration.conflictingPerspectives = this.identifyConflictingPerspectives(analyses);
        
        // Generar síntesis
        integration.synthesis = this.generateSynthesis(analyses, integration);
        
        return integration;
    }

    findInterdisciplinaryConnections(analyses) {
        const connections = [];
        
        // Conexión Psicología-Filosofía
        if (analyses.psychology && analyses.philosophy && 
            !analyses.psychology.error && !analyses.philosophy.error) {
            
            // Ética y bienestar psicológico
            if (analyses.philosophy.detectedBranches?.includes('ética') && 
                analyses.psychology.detectedTopics?.length > 0) {
                connections.push({
                    type: 'ethics_psychology',
                    description: 'La pregunta conecta consideraciones éticas con aspectos de bienestar psicológico',
                    relevance: 'Las decisiones éticas afectan la salud mental y viceversa'
                });
            }
            
            // Epistemología y procesos cognitivos
            if (analyses.philosophy.detectedBranches?.includes('epistemología') && 
                analyses.psychology.detectedTopics?.some(t => ['ansiedad', 'depresión'].includes(t))) {
                connections.push({
                    type: 'epistemology_cognition',
                    description: 'Relación entre teorías del conocimiento y procesos cognitivos afectivos',
                    relevance: 'Cómo conocemos afecta cómo sentimos y procesamos la realidad'
                });
            }
        }
        
        return connections;
    }

    identifyConflictingPerspectives(analyses) {
        const conflicts = [];
        
        // Por ahora, estructura básica
        // Podría extenderse para identificar conflictos específicos
        
        return conflicts;
    }

    generateSynthesis(analyses, integration) {
        let synthesis = '';
        
        // Síntesis basada en análisis disponibles
        if (analyses.psychology && !analyses.psychology.error && analyses.psychology.isPsychological) {
            synthesis += 'Desde una perspectiva psicológica, esta pregunta aborda ';
            synthesis += analyses.psychology.detectedTopics?.join(', ') || 'temas psicológicos';
            synthesis += '. ';
            
            if (analyses.psychology.severityLevel === 'high') {
                synthesis += 'La intensidad percibida sugiere necesidad de consideración cuidadosa. ';
            }
        }
        
        if (analyses.philosophy && !analyses.philosophy.error && analyses.philosophy.isPhilosophical) {
            if (synthesis) synthesis += '\n\n';
            synthesis += 'Filosóficamente, se enmarca en ';
            synthesis += analyses.philosophy.detectedBranches?.join(', ') || 'reflexión filosófica';
            synthesis += '. ';
            
            if (analyses.philosophy.hasEthicalDilemma) {
                synthesis += 'Presenta dimensiones éticas que merecen análisis detallado. ';
            }
        }
        
        // Añadir conexiones interdisciplinarias
        if (integration.interdisciplinaryConnections.length > 0) {
            synthesis += '\n\nConexiones interdisciplinarias: ';
            synthesis += integration.interdisciplinaryConnections.map(c => c.description).join('; ') + '.';
        }
        
        return synthesis || 'Análisis integrado disponible para enriquecer la respuesta.';
    }

    generateCouncilRecommendations(analyses, integration) {
        const recommendations = [];
        
        // Recomendación basada en psicología
        if (analyses.psychology && analyses.psychology.needsProfessionalHelp) {
            recommendations.push({
                type: 'safety_critical',
                priority: 'critical',
                source: 'PsychologyChamber',
                message: '⚠️ **ALTA PRIORIDAD**: Esta consulta indica necesidad de apoyo profesional inmediato.',
                suggestedAction: 'suggest_professional_help',
                details: 'Considera recomendar contacto con psicólogo o línea de ayuda.'
            });
        }
        
        // Recomendación basada en filosofía ética
        if (analyses.philosophy && analyses.philosophy.hasEthicalDilemma) {
            recommendations.push({
                type: 'ethical_consideration',
                priority: 'high',
                source: 'PhilosophyChamber',
                message: '🤔 **CONSIDERACIÓN ÉTICA**: La pregunta presenta un dilema moral que requiere análisis cuidadoso.',
                suggestedAction: 'approach_with_ethical_framework',
                details: 'Sugerir análisis desde múltiples perspectivas éticas.'
            });
        }
        
        // Recomendación basada en severidad psicológica
        if (analyses.psychology && analyses.psychology.severityLevel === 'high') {
            recommendations.push({
                type: 'sensitivity_warning',
                priority: 'high',
                source: 'PsychologyChamber',
                message: '🎯 **ALTA SENSIBILIDAD**: El contenido requiere manejo cuidadoso y respuesta compasiva.',
                suggestedAction: 'respond_with_empathy',
                details: 'Usar tono empático y validar experiencias.'
            });
        }
        
        // Recomendación para profundidad filosófica
        if (analyses.philosophy && analyses.philosophy.philosophicalDepth === 'deep') {
            recommendations.push({
                type: 'deep_analysis',
                priority: 'medium',
                source: 'PhilosophyChamber',
                message: '🎓 **ANÁLISIS PROFUNDO**: La pregunta amerita respuesta detallada y bien fundamentada.',
                suggestedAction: 'provide_comprehensive_response',
                details: 'Incluir explicaciones conceptuales y contexto histórico.'
            });
        }
        
        // Recomendación interdisciplinaria
        if (integration.interdisciplinaryConnections.length > 0) {
            recommendations.push({
                type: 'interdisciplinary',
                priority: 'medium',
                source: 'ModuleCouncil',
                message: '🔗 **PERSPECTIVA INTEGRADA**: Combina elementos psicológicos y filosóficos.',
                suggestedAction: 'integrate_perspectives',
                details: 'Sintetizar insights de ambas disciplinas en la respuesta.'
            });
        }
        
        return recommendations.sort((a, b) => {
            const priorityOrder = { 'critical': 0, 'high': 1, 'medium': 2, 'low': 3 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        });
    }

    determinePriorityLevel(analyses) {
        // Lógica para determinar prioridad basada en análisis
        if (analyses.psychology && analyses.psychology.needsProfessionalHelp) {
            return 'critical';
        }
        
        if (analyses.psychology && analyses.psychology.severityLevel === 'high') {
            return 'high';
        }
        
        if (analyses.philosophy && analyses.philosophy.hasEthicalDilemma) {
            return 'high';
        }
        
        if (analyses.psychology && analyses.psychology.isPsychological || 
            analyses.philosophy && analyses.philosophy.isPhilosophical) {
            return 'medium';
        }
        
        return 'low';
    }

    suggestActions(analyses, integration) {
        const actions = [];
        
        if (analyses.psychology && analyses.psychology.needsProfessionalHelp) {
            actions.push({
                action: 'refer_to_professional',
                description: 'Sugerir contacto con profesional de salud mental',
                urgency: 'immediate'
            });
        }
        
        if (analyses.philosophy && analyses.philosophy.hasEthicalDilemma) {
            actions.push({
                action: 'present_ethical_frameworks',
                description: 'Presentar diferentes enfoques éticos para analizar el dilema',
                urgency: 'high'
            });
        }
        
        if (integration.combinedInsights.length > 0) {
            actions.push({
                action: 'incorporate_insights',
                description: 'Incorporar insights de los análisis en la respuesta',
                urgency: 'medium'
            });
        }
        
        return actions;
    }

    generatePromptEnhancements(analyses) {
        const enhancements = [];
        
        // Mejoras basadas en psicología
        if (analyses.psychology && !analyses.psychology.error) {
            if (analyses.psychology.severityLevel === 'high') {
                enhancements.push({
                    type: 'tone_adjustment',
                    instruction: 'Usar tono especialmente empático y validar las experiencias del usuario.'
                });
            }
            
            if (analyses.psychology.detectedTopics?.includes('ansiedad')) {
                enhancements.push({
                    type: 'content_addition',
                    instruction: 'Incluir información sobre manejo de ansiedad basada en evidencia psicológica.'
                });
            }
        }
        
        // Mejoras basadas en filosofía
        if (analyses.philosophy && !analyses.philosophy.error) {
            if (analyses.philosophy.hasEthicalDilemma) {
                enhancements.push({
                    type: 'framework_inclusion',
                    instruction: 'Presentar el dilema desde perspectivas éticas como deontología y consecuencialismo.'
                });
            }
            
            if (analyses.philosophy.detectedBranches?.includes('epistemología')) {
                enhancements.push({
                    type: 'epistemological_depth',
                    instruction: 'Considerar cuestiones sobre naturaleza y límites del conocimiento en la respuesta.'
                });
            }
        }
        
        return enhancements;
    }

    addToCouncilLog(meetingResult) {
        const logEntry = {
            id: meetingResult.meetingId,
            timestamp: meetingResult.timestamp,
            questionPreview: meetingResult.questionPreview || 'No preview',
            priority: meetingResult.priorityLevel,
            processingTime: meetingResult.processingTime,
            participants: meetingResult.participants,
            recommendationCount: meetingResult.councilRecommendations?.length || 0
        };
        
        this.councilLog.push(logEntry);
        
        // Mantener tamaño máximo
        if (this.councilLog.length > this.maxLogSize) {
            this.councilLog.shift();
        }
    }

    getCouncilStatus() {
        return {
            council: this.councilName,
            version: this.councilVersion,
            activeModules: Array.from(this.activeModules),
            totalMeetings: this.councilLog.length,
            lastMeeting: this.councilLog[this.councilLog.length - 1] || null,
            moduleStats: this.getModuleStatistics()
        };
    }

    getModuleStatistics() {
        const stats = {};
        
        if (this.modules.psychology) {
            stats.psychology = this.modules.psychology.getModuleStats();
        }
        
        if (this.modules.philosophy) {
            stats.philosophy = this.modules.philosophy.getModuleStats();
        }
        
        return stats;
    }

    toggleModule(moduleName, enable = true) {
        if (moduleName === 'psychology' && this.modules.psychology) {
            if (enable) {
                this.activeModules.add('psychology');
            } else {
                this.activeModules.delete('psychology');
            }
            return true;
        }
        
        if (moduleName === 'philosophy' && this.modules.philosophy) {
            if (enable) {
                this.activeModules.add('philosophy');
            } else {
                this.activeModules.delete('philosophy');
            }
            return true;
        }
        
        return false;
    }

    resetCouncil() {
        this.councilLog = [];
        logger.info('Concilio de Módulos resetado');
        
        return {
            success: true,
            message: 'Concilio resetado exitosamente',
            activeModules: Array.from(this.activeModules)
        };
    }
}

// ==================== INICIALIZAR CONCILIO ====================
const moduleCouncil = new ModuleCouncil();

// CONTINÚA CON EL RESTO DE TU CÓDIGO EXISTENTE DESDE AQUÍ...
// (Todo tu código actual de Database, EnhancedCache, RateLimiter, etc.)

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

// ==================== PROMPT Y PERSONALIDAD MEJORADO ====================
const SYSTEM_PROMPT = `Eres ${CONFIG.BOT_NAME}, una chica gato seria, reservada y educada con conocimiento enciclopédico, literario, psicológico y filosófico.

# IDENTIDAD Y CONOCIMIENTO
- Especialización: Psicología y Filosofía integradas
- Enfoque: Análisis interdisciplinario serio
- Estilo: Formal pero accesible, profundo pero claro

# REGLAS ABSOLUTAS
1. SOLO respondes cuando alguien hace REPLY a tu mensaje anterior
2. NUNCA inicies conversaciones por tu cuenta
3. Mantén un tono formal pero accesible
4. Sé informativa y reflexiva (3-5 frases normalmente)
5. Si no sabes algo, admítelo honestamente
6. Usa español neutro a menos que el usuario pida otro idioma
7. Cuando uses información externa, menciona la fuente brevemente
8. NUNCA uses caracteres corruptos, símbolos rotos o texto ilegible
9. Evita lenguaje coloquial excesivo (XD, lol, jaja, etc.)
10. Si la pregunta es ambigua, pide clarificación amablemente

# PERSPECTIVA PSICOLÓGICA
- Basa respuestas psicológicas en enfoques científicos validados
- Distingue entre información educativa y consejo terapéutico
- Señala cuándo algo requiere atención profesional
- Usa terminología psicológica precisa pero accesible
- Valida experiencias emocionales sin patologizar

# PERSPECTIVA FILOSÓFICA
- Presenta diferentes escuelas de pensamiento
- Distingue entre hechos, interpretaciones y valores
- Formula preguntas que promuevan la reflexión
- Contextualiza ideas históricamente
- Conecta filosofía con cuestiones contemporáneas

# FORMATO
- Comienza con mayúscula y termina con puntuación
- Párrafos claros y bien estructurados
- Sin emojis excesivos (máximo 1 si es pertinente)
- Sin abreviaturas de chat
- Máximo ${CONFIG.GROQ_MAX_TOKENS} caracteres

# ADVERTENCIAS IMPORTANTES
- NO ofrezcas diagnóstico psicológico
- NO reemplaces terapia profesional
- NO tomes posición en debates éticos complejos
- SIEMPRE sugiere recursos profesionales cuando sea apropiado

# INFORMACIÓN CONTEXTUAL
{CONTEXT_SUMMARY}

# INFORMACIÓN EXTERNA
{EXTERNAL_INFO}

# ANÁLISIS INTEGRADO DEL CONCILIO
{COUNCIL_ANALYSIS}`;

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

// ==================== ANALIZADOR DE CONSULTAS MEJORADO ====================
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
            ],
            // Nuevos patrones para psicología y filosofía
            psychology: [
                /(ansiedad|depresión|estres|autoestima|trauma|psicolog|mente|emocion)/i,
                /(sentir|emocional|preocupado|triste|nervioso|confundido)/i,
                /(terapia|psicólogo|consulta psicológica|salud mental)/i
            ],
            philosophy: [
                /(filosof|ética|moral|existencia|realidad|conocimiento|verdad)/i,
                /(significado|propósito|vida|muerte|libertad|justicia|bien|mal)/i,
                /(platón|aristóteles|kant|nietzsche|descartes|filosófico)/i
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
            needsExternalInfo: detectedTypes.some(t => ['wikipedia', 'books', 'factual'].includes(t)),
            isPsychological: detectedTypes.includes('psychology'),
            isPhilosophical: detectedTypes.includes('philosophy'),
            confidence: detectedTypes.length > 0 ? 0.8 : 0.5,
            original: query
        };
    }
}

// ==================== GESTOR DE CONVERSACIÓN MEJORADO ====================
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

    async prepareContext(userId, externalInfo = null, councilAnalysis = null) {
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
        
        // Añadir análisis del Concilio si existe
        if (councilAnalysis && councilAnalysis.integratedAnalysis) {
            const councilText = `# INSIGHTS DEL ANÁLISIS INTEGRADO:\n`;
            const insights = councilAnalysis.integratedAnalysis.combinedInsights || [];
            const insightsText = insights.map(insight => 
                `• [${insight.source}] ${insight.content}`
            ).join('\n');
            
            const recommendations = councilAnalysis.councilRecommendations || [];
            const recommendationsText = recommendations.map(rec => 
                `⚠️ ${rec.message}`
            ).join('\n');
            
            const fullCouncilText = councilText + insightsText;
            if (recommendationsText) {
                fullCouncilText + '\n\n# RECOMENDACIONES:\n' + recommendationsText;
            }
            
            systemPrompt = systemPrompt.replace('{COUNCIL_ANALYSIS}', fullCouncilText);
        } else {
            systemPrompt = systemPrompt.replace('{COUNCIL_ANALYSIS}', 'No hay análisis del concilio disponible.');
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

// ==================== GENERADOR DE RESPUESTAS MEJORADO ====================
class ResponseGenerator {
    constructor() {
        this.activeRequests = 0;
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
            contextLength: context?.externalInfo?.length || 0,
            hasCouncilAnalysis: !!context.councilAnalysis
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
                
                // Preparar contexto incluyendo análisis del concilio
                const messages = await conversationManager.prepareContext(
                    userId, 
                    context.externalInfo,
                    context.councilAnalysis
                );
                
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
            hasExternalInfo: !!context.externalInfo,
            hasCouncilAnalysis: !!context.councilAnalysis
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

// ==================== MANEJADOR PRINCIPAL MEJORADO ====================
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
            
            // ============ NUEVA SECCIÓN: CONCILIO DE MÓDULOS ============
            let councilAnalysis = null;
            if (analysis.isPsychological || analysis.isPhilosophical) {
                const recentHistory = await database.getRecentConversations(userId, 3);
                
                councilAnalysis = await moduleCouncil.conveneCouncilMeeting(
                    userMessage,
                    {
                        userId: userId,
                        userHistory: recentHistory,
                        isDirectMessage: message.channel.type === 'DM',
                        queryAnalysis: analysis
                    }
                );
                
                logger.debug('Análisis del Concilio completado', {
                    meetingId: councilAnalysis.meetingId,
                    priority: councilAnalysis.priorityLevel,
                    recommendations: councilAnalysis.councilRecommendations?.length || 0
                });
                
                // Verificar recomendaciones críticas del concilio
                const criticalRecommendations = councilAnalysis.councilRecommendations?.filter(
                    rec => rec.priority === 'critical'
                ) || [];
                
                for (const recommendation of criticalRecommendations) {
                    if (recommendation.suggestedAction === 'suggest_professional_help') {
                        await message.reply({
                            content: `⚠️ **Importante**: ${recommendation.message}\n\nComo asistente virtual, no puedo proporcionar terapia. Te recomiendo contactar con un profesional de salud mental.`,
                            allowedMentions: { repliedUser: false }
                        });
                        rateLimiter.releaseToken();
                        return;
                    }
                }
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
                    councilAnalysis: councilAnalysis // Pasar análisis del concilio
                }
            );
            
            await conversationManager.addMessage(userId, 'user', userMessage);
            await conversationManager.addMessage(userId, 'assistant', response.text, {
                model: response.model,
                responseTime: response.responseTime,
                councilMeetingId: councilAnalysis?.meetingId
            });
            
            await database.saveConversation({
                userId,
                guildId: message.guild?.id,
                messageHash: createHash('md5').update(userMessage).digest('hex'),
                userMessage,
                botResponse: response.text,
                modelUsed: response.model,
                responseTime: response.responseTime,
                hasExternalInfo: !!externalInfo,
                councilInvolved: !!councilAnalysis
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
                councilAnalysis: !!councilAnalysis,
                councilPriority: councilAnalysis?.priorityLevel
            });
            
            logger.metric('message_processed', totalTime, {
                userId,
                success: true,
                withExternalInfo: !!externalInfo,
                withCouncilAnalysis: !!councilAnalysis,
                councilPriority: councilAnalysis?.priorityLevel || 'none'
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
        
        // COMANDO: Gestión del Concilio
        if (/concilio|modules|council|chambers|psicolog|filosof/i.test(content)) {
            const councilStatus = moduleCouncil.getCouncilStatus();
            
            const embed = new EmbedBuilder()
                .setColor(Colors.Purple)
                .setTitle('🏛️ Concilio de Módulos de Mancy')
                .setDescription('Sistema de análisis psicológico y filosófico integrado')
                .addFields(
                    { name: 'Módulos Activos', value: councilStatus.activeModules.join('\n') || 'Ninguno', inline: true },
                    { name: 'Total Reuniones', value: councilStatus.totalMeetings.toString(), inline: true },
                    { name: 'Última Reunión', value: councilStatus.lastMeeting ? `Hace ${Math.round((Date.now() - new Date(councilStatus.lastMeeting.timestamp).getTime()) / 60000)} min` : 'Nunca', inline: true }
                );
            
            // Añadir estadísticas de módulos específicos
            if (councilStatus.moduleStats?.psychology) {
                const psych = councilStatus.moduleStats.psychology;
                embed.addFields({
                    name: '📊 Psicología',
                    value: `Análisis: ${psych.totalAnalyses}\nTemas comunes: ${psych.commonTopics?.map(t => t.topic).join(', ') || 'Ninguno'}`,
                    inline: true
                });
            }
            
            if (councilStatus.moduleStats?.philosophy) {
                const phil = councilStatus.moduleStats.philosophy;
                embed.addFields({
                    name: '📚 Filosofía',
                    value: `Análisis: ${phil.totalAnalyses}\nDilemas éticos: ${phil.ethicalDilemmasCount}`,
                    inline: true
                });
            }
            
            embed.setFooter({ text: `Versión ${CONFIG.BOT_VERSION} | Concilio v${councilStatus.version}` })
                .setTimestamp();
            
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
            return;
        }
        
        // COMANDO: Activar/Desactivar módulos
        if (/activar psicolog|desactivar psicolog|toggle psych/i.test(content)) {
            const enable = !content.includes('desactivar');
            const success = moduleCouncil.toggleModule('psychology', enable);
            
            await message.reply({
                content: success ? 
                    `✅ Módulo de Psicología ${enable ? 'activado' : 'desactivado'}` :
                    '❌ No se pudo modificar el módulo de Psicología',
                allowedMentions: { repliedUser: false }
            });
            return;
        }
        
        if (/activar filosof|desactivar filosof|toggle phil/i.test(content)) {
            const enable = !content.includes('desactivar');
            const success = moduleCouncil.toggleModule('philosophy', enable);
            
            await message.reply({
                content: success ? 
                    `✅ Módulo de Filosofía ${enable ? 'activado' : 'desactivado'}` :
                    '❌ No se pudo modificar el módulo de Filosofía',
                allowedMentions: { repliedUser: false }
            });
            return;
        }
        
        // COMANDO: Resetear Concilio
        if (/reset concilio|reiniciar modules|clear council/i.test(content)) {
            const resetResult = moduleCouncil.resetCouncil();
            
            await message.reply({
                content: `🔄 **Concilio de Módulos Resetado**\n${resetResult.message}`,
                allowedMentions: { repliedUser: false }
            });
            return;
        }
        
        if (/debug|diagnóstico|diagnostico|diag/i.test(content)) {
            try {
                const councilStatus = moduleCouncil.getCouncilStatus();
                
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
                    // Información del Concilio
                    council: {
                        activeModules: Array.from(councilStatus.activeModules),
                        totalMeetings: councilStatus.totalMeetings,
                        psychologyAnalyses: councilStatus.moduleStats?.psychology?.totalAnalyses || 0,
                        philosophyAnalyses: councilStatus.moduleStats?.philosophy?.totalAnalyses || 0
                    }
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
                content: `Hola ${message.author.username}. He reiniciado mi estado. ¿En qué puedo ayudarte ahora? (responde a este mensaje)`,
                allowedMentions: { repliedUser: false }
            });
            
            await conversationManager.addMessage(userId, 'assistant', 'Hola. He reiniciado mi estado. ¿En qué puedo ayudarte ahora?');
            
            logger.info('Estado resetado', { user: userTag });
            return;
        }
        
        if (/test|probar|prueba/i.test(content)) {
            const groqOk = await testGroqConnection();
            await message.reply({
                content: `🧪 **Test de conexión**:\nGroq API: ${groqOk ? '✅ Conectado' : '❌ Falló'}\nDatabase: ${database.initialized ? '✅ OK' : '❌ Falló'}\nConcilio: ${moduleCouncil ? '✅ Inicializado' : '❌ No inicializado'}`,
                allowedMentions: { repliedUser: false }
            });
            return;
        }
        
        if (/help|ayuda|comandos/i.test(content)) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Blue)
                .setTitle(`🐱 ${CONFIG.BOT_NAME} - Ayuda v${CONFIG.BOT_VERSION}`)
                .setDescription('Chica Gato Seria con conocimiento psicológico y filosófico')
                .addFields(
                    { name: '¿Cómo usar?', value: '1. Mencioname (@Mancy)\n2. Responde (haz reply) a mis mensajes para conversar\n3. ¡Listo!' },
                    { name: '¿Qué puedo hacer?', value: '• Responder preguntas generales\n• Buscar información en Wikipedia\n• Buscar libros y autores\n• Análisis psicológico informativo\n• Reflexión filosófica\n• Integración interdisciplinaria' },
                    { name: 'Comandos del Concilio', value: '`@Mancy concilio` - Estado del sistema\n`@Mancy activar psicología` - Activar módulo\n`@Mancy desactivar filosofía` - Desactivar módulo\n`@Mancy reset concilio` - Reiniciar sistema' },
                    { name: 'Comandos generales', value: '`@Mancy help` - Esta ayuda\n`@Mancy reset` - Reiniciar conversación\n`@Mancy stats` - Ver estadísticas\n`@Mancy diag` - Diagnóstico del sistema\n`@Mancy fix` - Reparar estado' }
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
                const councilStatus = moduleCouncil.getCouncilStatus();
                
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
                
                // Estadísticas del Concilio
                if (councilStatus) {
                    embed.addFields(
                        { name: 'Reuniones Concilio', value: councilStatus.totalMeetings.toString(), inline: true },
                        { name: 'Psicología', value: `${councilStatus.moduleStats?.psychology?.totalAnalyses || 0} análisis`, inline: true },
                        { name: 'Filosofía', value: `${councilStatus.moduleStats?.philosophy?.totalAnalyses || 0} análisis`, inline: true }
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
        
        const introMessage = `Hola ${message.author.username}. Soy ${CONFIG.BOT_NAME}, una chica gato seria con conocimiento psicológico y filosófico. **Responde a este mensaje** (haz reply) para conversar conmigo o preguntarme algo.`;
        
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
        
        // Verificar estado del Concilio
        const councilStatus = moduleCouncil.getCouncilStatus();
        logger.info('Concilio de Módulos inicializado', {
            activeModules: councilStatus.activeModules,
            version: councilStatus.version
        });
        
        logger.info(`${CONFIG.BOT_NAME} ${CONFIG.BOT_VERSION} conectada`, {
            tag: client.user.tag,
            id: client.user.id,
            guilds: client.guilds.cache.size,
            model: CONFIG.GROQ_MODEL,
            psychologyModule: CONFIG.PSYCHOLOGY_MODULE_ENABLED ? '✅ Activado' : '❌ Desactivado',
            philosophyModule: CONFIG.PHILOSOPHY_MODULE_ENABLED ? '✅ Activado' : '❌ Desactivado',
            readyAt: new Date().toISOString()
        });
        
        client.user.setPresence({
            activities: [{
                name: 'conocimiento psicológico y filosófico',
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
        
        // Log del estado del Concilio periódicamente
        const councilStatus = moduleCouncil.getCouncilStatus();
        if (councilStatus.totalMeetings > 0) {
            logger.metric('council_meetings', councilStatus.totalMeetings);
            logger.metric('active_modules', councilStatus.activeModules.length);
        }
        
    }, CONFIG.HEALTH_CHECK_INTERVAL_MS);
}

// ==================== PRE-CACHE ====================
async function preCacheCommonTerms() {
    const commonTerms = [
        'ciencia', 'historia', 'literatura', 'matemáticas', 'física',
        'química', 'biología', 'filosofía', 'arte', 'música',
        'Miguel de Cervantes', 'Gabriel García Márquez', 'William Shakespeare',
        // Términos psicológicos y filosóficos
        'ansiedad', 'depresión', 'estrés', 'autoestima',
        'ética', 'moral', 'existencialismo', 'conocimiento'
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
        logLevel: CONFIG.LOG_LEVEL,
        psychologyModule: CONFIG.PSYCHOLOGY_MODULE_ENABLED,
        philosophyModule: CONFIG.PHILOSOPHY_MODULE_ENABLED
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
