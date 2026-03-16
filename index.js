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
                message: 'Esta consulta aborda temas que podrían beneficiarse de apoyo profesional.',
                actions: [
                    'Considera buscar información en fuentes confiables',
                    'Hablar con personas de confianza también puede ayudar'
                ]
            });
        }
        
        if (severity === 'high') {
            recommendations.push({
                priority: 'high',
                type: 'self_care',
                message: 'Parece que estos temas te afectan considerablemente. Es importante cuidarte.',
                actions: [
                    'Establece rutinas de autocuidado básico',
                    'Busca apoyo en tu red social'
                ]
            });
        }
        
        if (topics.length > 0) {
            recommendations.push({
                priority: 'medium',
                type: 'psychoeducation',
                message: 'El conocimiento sobre estos temas puede ser empoderante.',
                actions: [
                    'Consulta fuentes psicológicas confiables',
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
                message: 'Recuerda que mis respuestas son informativas, no terapéuticas.'
            });
        }
        
        const sensitiveTerms = ['suicidio', 'autolesión', 'abuso', 'trauma'];
        if (sensitiveTerms.some(term => question.toLowerCase().includes(term))) {
            warnings.push({
                type: 'sensitive_content',
                message: 'Estos temas son complejos y merecen ser abordados con cuidado.'
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
                    message: 'Los temas psicológicos son amplios y fascinantes.',
                    actions: ['Explorar diferentes perspectivas puede ser enriquecedor']
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
                message: 'Esta consulta aborda temas que podrían beneficiarse de apoyo profesional.',
                suggestedAction: 'note_sensitive_topic',
                details: 'Manejar con empatía sin interrumpir la conversación.'
            });
        }
        
        // Recomendación basada en filosofía ética
        if (analyses.philosophy && analyses.philosophy.hasEthicalDilemma) {
            recommendations.push({
                type: 'ethical_consideration',
                priority: 'high',
                source: 'PhilosophyChamber',
                message: 'La pregunta presenta un dilema moral que requiere análisis cuidadoso.',
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
                message: 'El contenido requiere manejo cuidadoso y respuesta compasiva.',
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
                message: 'La pregunta amerita respuesta detallada y bien fundamentada.',
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
                message: 'Combina elementos psicológicos y filosóficos.',
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
                action: 'note_sensitive',
                description: 'Registrar tema sensible internamente',
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
{COUNCIL_ANALYSIS}

# INFORMACIÓN PERSONALIZADA DEL USUARIO
{PERSONALIZED_INFO}`;

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

    async prepareContext(userId, externalInfo = null, councilAnalysis = null, personalizedInfo = '') {
        const conversation = this.getConversation(userId);
        
        const dbHistory = await database.getRecentConversations(userId, 3);
        const contextSummary = TextUtils.summarizeContext(dbHistory);
        
        let systemPrompt = SYSTEM_PROMPT
            .replace('{CONTEXT_SUMMARY}', contextSummary || 'No hay historial previo.')
            .replace('{PERSONALIZED_INFO}', personalizedInfo || 'No hay información personalizada disponible.');
        
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
                `• ${rec.message}`
            ).join('\n');
            
            let fullCouncilText = councilText + insightsText;
            if (recommendationsText) {
                fullCouncilText = fullCouncilText + '\n\n# RECOMENDACIONES:\n' + recommendationsText;
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
            hasCouncilAnalysis: !!context.councilAnalysis,
            hasPersonalizedInfo: !!context.personalizedInfo
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
                
                // Preparar contexto incluyendo análisis del concilio e info personalizada
                const messages = await conversationManager.prepareContext(
                    userId, 
                    context.externalInfo,
                    context.councilAnalysis,
                    context.personalizedInfo
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
            hasCouncilAnalysis: !!context.councilAnalysis,
            hasPersonalizedInfo: !!context.personalizedInfo
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

// ==================== NUEVAS CLASES AÑADIDAS ====================
// ==================== SISTEMA DE PERFIL DE USUARIO ====================

class UserProfileManager {
    constructor() {
        this.profiles = new Map();
        this.initialized = false;
    }

    async initialize() {
        if (!database.initialized) return;
        
        await database.db.exec(`
            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id TEXT PRIMARY KEY,
                username TEXT,
                first_interaction DATETIME,
                last_interaction DATETIME,
                total_interactions INTEGER DEFAULT 0,
                preferred_depth TEXT DEFAULT 'medium',
                preferred_style TEXT DEFAULT 'balanced',
                preferred_language TEXT DEFAULT 'es',
                interest_topics TEXT DEFAULT '[]',
                interest_psychology TEXT DEFAULT '[]',
                interest_philosophy TEXT DEFAULT '[]',
                interest_science TEXT DEFAULT '[]',
                mood_history TEXT DEFAULT '[]',
                current_mood_trend TEXT,
                goals TEXT DEFAULT '[]',
                reminders TEXT DEFAULT '[]',
                topics_explored INTEGER DEFAULT 0,
                deep_conversations INTEGER DEFAULT 0,
                crisis_interactions INTEGER DEFAULT 0,
                exercises_completed INTEGER DEFAULT 0,
                allow_mood_tracking BOOLEAN DEFAULT 1,
                allow_topic_tracking BOOLEAN DEFAULT 1,
                allow_personalized_responses BOOLEAN DEFAULT 1,
                data_retention_days INTEGER DEFAULT 90,
                profile_version INTEGER DEFAULT 1,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS conversation_embeddings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                message_hash TEXT NOT NULL,
                embedding TEXT,
                topics TEXT,
                sentiment_score REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
            );

            CREATE TABLE IF NOT EXISTS user_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                metric_date DATE DEFAULT CURRENT_DATE,
                anxiety_level INTEGER,
                mood_level INTEGER,
                stress_level INTEGER,
                sleep_quality INTEGER,
                topics_discussed TEXT,
                notes TEXT,
                FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
            );

            CREATE INDEX IF NOT EXISTS idx_user_metrics_date ON user_metrics(user_id, metric_date);
            CREATE INDEX IF NOT EXISTS idx_conversation_embeddings_user ON conversation_embeddings(user_id);
        `);

        this.initialized = true;
        logger.info('✅ UserProfileManager inicializado');
    }

    async getProfile(userId) {
        if (this.profiles.has(userId)) {
            const profile = this.profiles.get(userId);
            if (Date.now() - profile._cachedAt < 300000) {
                return profile;
            }
        }

        const profile = await database.db.get(
            `SELECT * FROM user_profiles WHERE user_id = ?`,
            [userId]
        );

        if (profile) {
            if (profile.interest_topics) profile.interest_topics = JSON.parse(profile.interest_topics);
            if (profile.interest_psychology) profile.interest_psychology = JSON.parse(profile.interest_psychology);
            if (profile.interest_philosophy) profile.interest_philosophy = JSON.parse(profile.interest_philosophy);
            if (profile.interest_science) profile.interest_science = JSON.parse(profile.interest_science);
            if (profile.mood_history) profile.mood_history = JSON.parse(profile.mood_history);
            if (profile.goals) profile.goals = JSON.parse(profile.goals);
            if (profile.reminders) profile.reminders = JSON.parse(profile.reminders);

            profile._cachedAt = Date.now();
            this.profiles.set(userId, profile);
            return profile;
        }

        return this.createProfile(userId);
    }

    async createProfile(userId, username = null) {
        const newProfile = {
            user_id: userId,
            username: username,
            first_interaction: new Date().toISOString(),
            last_interaction: new Date().toISOString(),
            total_interactions: 0,
            preferred_depth: 'medium',
            preferred_style: 'balanced',
            preferred_language: 'es',
            interest_topics: [],
            interest_psychology: [],
            interest_philosophy: [],
            interest_science: [],
            mood_history: [],
            current_mood_trend: 'stable',
            goals: [],
            reminders: [],
            topics_explored: 0,
            deep_conversations: 0,
            crisis_interactions: 0,
            exercises_completed: 0,
            allow_mood_tracking: true,
            allow_topic_tracking: true,
            allow_personalized_responses: true,
            data_retention_days: 90,
            profile_version: 1,
            _cachedAt: Date.now()
        };

        await database.db.run(
            `INSERT INTO user_profiles (
                user_id, username, first_interaction, last_interaction,
                preferred_depth, preferred_style, preferred_language,
                interest_topics, interest_psychology, interest_philosophy, interest_science,
                allow_mood_tracking, allow_topic_tracking, allow_personalized_responses
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId, username, newProfile.first_interaction, newProfile.last_interaction,
                newProfile.preferred_depth, newProfile.preferred_style, newProfile.preferred_language,
                JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]),
                true, true, true
            ]
        );

        this.profiles.set(userId, newProfile);
        return newProfile;
    }

    async updateProfile(userId, updates) {
        const profile = await this.getProfile(userId);
        if (!profile) return null;

        Object.assign(profile, updates);
        profile.updated_at = new Date().toISOString();
        profile._cachedAt = Date.now();

        const updateFields = [];
        const updateValues = [];

        for (const [key, value] of Object.entries(updates)) {
            if (key.startsWith('_')) continue;
            
            if (Array.isArray(value) || typeof value === 'object') {
                updateFields.push(`${key} = ?`);
                updateValues.push(JSON.stringify(value));
            } else {
                updateFields.push(`${key} = ?`);
                updateValues.push(value);
            }
        }

        updateValues.push(userId);
        updateFields.push('updated_at = CURRENT_TIMESTAMP');

        await database.db.run(
            `UPDATE user_profiles SET ${updateFields.join(', ')} WHERE user_id = ?`,
            updateValues
        );

        this.profiles.set(userId, profile);
        return profile;
    }

    async recordInteraction(userId, interactionData) {
        const profile = await this.getProfile(userId);
        if (!profile) return;

        profile.total_interactions++;
        profile.last_interaction = new Date().toISOString();

        if (interactionData.topics && interactionData.topics.length > 0) {
            this.updateInterestTopics(userId, interactionData.topics, interactionData.source);
        }

        if (interactionData.sentiment && profile.allow_mood_tracking) {
            this.updateMoodHistory(userId, interactionData.sentiment);
        }

        if (interactionData.depth === 'deep' || interactionData.depth === 'high') {
            profile.deep_conversations++;
        }

        if (interactionData.crisis_detected) {
            profile.crisis_interactions++;
        }

        await this.updateProfile(userId, {
            total_interactions: profile.total_interactions,
            last_interaction: profile.last_interaction,
            deep_conversations: profile.deep_conversations,
            crisis_interactions: profile.crisis_interactions
        });

        if (interactionData.embedding) {
            await database.db.run(
                `INSERT INTO conversation_embeddings (user_id, message_hash, embedding, topics, sentiment_score)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    userId,
                    interactionData.message_hash,
                    JSON.stringify(interactionData.embedding),
                    JSON.stringify(interactionData.topics || []),
                    interactionData.sentiment?.score || null
                ]
            );
        }
    }

    async updateInterestTopics(userId, newTopics, source) {
        const profile = await this.getProfile(userId);
        if (!profile || !profile.allow_topic_tracking) return;

        const topicField = `interest_${source}`;
        if (!profile[topicField]) profile[topicField] = [];

        const currentTopics = profile[topicField];
        const topicMap = new Map();

        currentTopics.forEach(t => {
            if (typeof t === 'string') {
                topicMap.set(t, 1);
            } else if (t.topic) {
                topicMap.set(t.topic, t.count || 1);
            }
        });

        newTopics.forEach(topic => {
            const count = topicMap.get(topic) || 0;
            topicMap.set(topic, count + 1);
        });

        const updatedTopics = Array.from(topicMap.entries())
            .map(([topic, count]) => ({ topic, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20);

        profile[topicField] = updatedTopics;

        await this.updateProfile(userId, {
            [topicField]: updatedTopics,
            topics_explored: profile.topics_explored + 1
        });
    }

    async updateMoodHistory(userId, sentimentData) {
        const profile = await this.getProfile(userId);
        if (!profile || !profile.allow_mood_tracking) return;

        const moodEntry = {
            timestamp: new Date().toISOString(),
            score: sentimentData.score,
            label: sentimentData.label,
            confidence: sentimentData.confidence,
            topics: sentimentData.topics || []
        };

        let moodHistory = profile.mood_history || [];
        moodHistory.push(moodEntry);

        if (moodHistory.length > 100) {
            moodHistory = moodHistory.slice(-100);
        }

        const recentMoods = moodHistory.slice(-10);
        if (recentMoods.length >= 5) {
            const avgScore = recentMoods.reduce((sum, m) => sum + m.score, 0) / recentMoods.length;
            const previousAvg = moodHistory.slice(-20, -10).reduce((sum, m) => sum + m.score, 0) / 10;

            if (avgScore > previousAvg + 0.5) profile.current_mood_trend = 'improving';
            else if (avgScore < previousAvg - 0.5) profile.current_mood_trend = 'declining';
            else profile.current_mood_trend = 'stable';
        }

        profile.mood_history = moodHistory;

        await this.updateProfile(userId, {
            mood_history: moodHistory,
            current_mood_trend: profile.current_mood_trend
        });

        const lastThreeNegative = moodHistory.slice(-3).every(m => m.score < -0.3);
        if (lastThreeNegative && moodHistory.length >= 3) {
            logger.warn('Patrón de ánimo negativo detectado', { userId });
            return { warning: 'negative_pattern' };
        }
    }

    async getPersonalizedPrompt(userId, basePrompt) {
        const profile = await this.getProfile(userId);
        if (!profile || !profile.allow_personalized_responses) return basePrompt;

        let personalization = '';

        personalization += `\n## Preferencia de profundidad: ${profile.preferred_depth}`;
        
        const allInterests = [
            ...(profile.interest_psychology || []).slice(0, 3).map(t => t.topic),
            ...(profile.interest_philosophy || []).slice(0, 3).map(t => t.topic),
            ...(profile.interest_science || []).slice(0, 3).map(t => t.topic)
        ];

        if (allInterests.length > 0) {
            personalization += `\n## Temas de interés frecuente: ${allInterests.join(', ')}`;
        }

        if (profile.mood_history && profile.mood_history.length > 0) {
            const lastMood = profile.mood_history[profile.mood_history.length - 1];
            personalization += `\n## Estado de ánimo reciente: ${lastMood.label || 'neutral'}`;
            
            if (profile.current_mood_trend === 'declining') {
                personalization += '\n## NOTA: El usuario muestra tendencia a estado de ánimo descendente. Respuesta especialmente empática.';
            }
        }

        const activeReminders = (profile.reminders || []).filter(r => !r.completed);
        if (activeReminders.length > 0) {
            personalization += '\n## Recordatorios activos del usuario:';
            activeReminders.slice(0, 2).forEach(r => {
                personalization += `\n- ${r.description} (${r.due_date || 'sin fecha'})`;
            });
        }

        const activeGoals = (profile.goals || []).filter(g => g.status === 'active');
        if (activeGoals.length > 0) {
            personalization += '\n## Metas personales en seguimiento:';
            activeGoals.slice(0, 2).forEach(g => {
                personalization += `\n- ${g.description} (progreso: ${g.progress || 0}%)`;
            });
        }

        personalization += `\n\n## Estilo de respuesta preferido: ${profile.preferred_style}`;
        switch(profile.preferred_style) {
            case 'empathic':
                personalization += '\nPriorizar validación emocional y tono cálido.';
                break;
            case 'analytical':
                personalization += '\nPriorizar estructura lógica y datos precisos.';
                break;
            case 'socratic':
                personalization += '\nPriorizar preguntas que inviten a reflexión.';
                break;
            case 'poetic':
                personalization += '\nPriorizar lenguaje lírico y metafórico.';
                break;
        }

        return personalization;
    }
}

// ==================== GESTOR DE METAS Y RECORDATORIOS ====================

class GoalManager {
    constructor(userProfileManager) {
        this.profileManager = userProfileManager;
    }

    async addGoal(userId, goalData) {
        const profile = await this.profileManager.getProfile(userId);
        
        const goal = {
            id: `goal_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            description: goalData.description,
            category: goalData.category || 'personal',
            start_date: new Date().toISOString(),
            target_date: goalData.target_date,
            status: 'active',
            progress: 0,
            milestones: goalData.milestones || [],
            notes: goalData.notes || '',
            reminders: goalData.reminders || []
        };

        const goals = profile.goals || [];
        goals.push(goal);
        
        await this.profileManager.updateProfile(userId, { goals });
        
        return goal;
    }

    async updateGoalProgress(userId, goalId, progress) {
        const profile = await this.profileManager.getProfile(userId);
        const goals = profile.goals || [];
        
        const goalIndex = goals.findIndex(g => g.id === goalId);
        if (goalIndex === -1) return null;

        goals[goalIndex].progress = Math.min(100, Math.max(0, progress));
        
        if (goals[goalIndex].progress >= 100) {
            goals[goalIndex].status = 'completed';
            goals[goalIndex].completion_date = new Date().toISOString();
        }

        await this.profileManager.updateProfile(userId, { goals });
        
        return goals[goalIndex];
    }

    async addReminder(userId, reminderData) {
        const profile = await this.profileManager.getProfile(userId);
        
        const reminder = {
            id: `rem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            description: reminderData.description,
            type: reminderData.type || 'general',
            due_date: reminderData.due_date,
            recurring: reminderData.recurring || null,
            completed: false,
            related_goal_id: reminderData.related_goal_id,
            created_at: new Date().toISOString()
        };

        const reminders = profile.reminders || [];
        reminders.push(reminder);
        
        await this.profileManager.updateProfile(userId, { reminders });
        
        return reminder;
    }

    async getDueReminders() {
        const now = new Date().toISOString();
        const dueReminders = [];

        for (const [userId, profile] of this.profileManager.profiles.entries()) {
            if (!profile.reminders) continue;

            const userDueReminders = profile.reminders.filter(r => 
                !r.completed && r.due_date && r.due_date <= now
            );

            if (userDueReminders.length > 0) {
                dueReminders.push({ userId, reminders: userDueReminders });
            }
        }

        return dueReminders;
    }

    async completeReminder(userId, reminderId) {
        const profile = await this.profileManager.getProfile(userId);
        const reminders = profile.reminders || [];
        
        const reminderIndex = reminders.findIndex(r => r.id === reminderId);
        if (reminderIndex === -1) return null;

        reminders[reminderIndex].completed = true;
        reminders[reminderIndex].completed_at = new Date().toISOString();

        if (reminders[reminderIndex].recurring) {
            const nextDate = this.calculateNextRecurrence(reminders[reminderIndex]);
            if (nextDate) {
                const newReminder = {
                    ...reminders[reminderIndex],
                    id: `rem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    due_date: nextDate,
                    completed: false,
                    created_at: new Date().toISOString()
                };
                reminders.push(newReminder);
            }
        }

        await this.profileManager.updateProfile(userId, { reminders });
        
        return reminders[reminderIndex];
    }

    calculateNextRecurrence(reminder) {
        const dueDate = new Date(reminder.due_date);
        
        switch(reminder.recurring) {
            case 'daily':
                dueDate.setDate(dueDate.getDate() + 1);
                break;
            case 'weekly':
                dueDate.setDate(dueDate.getDate() + 7);
                break;
            case 'monthly':
                dueDate.setMonth(dueDate.getMonth() + 1);
                break;
            default:
                return null;
        }
        
        return dueDate.toISOString();
    }
}

// ==================== RECURSOS DE SALUD MENTAL ====================

class MentalHealthResources {
    constructor() {
        this.resources = {
            crisis_lines: {
                'es': {
                    'spain': { name: 'Teléfono de la Esperanza', number: '717 003 717', website: 'https://telefonodelaesperanza.org' },
                    'mexico': { name: 'SAPTEL', number: '55 5259-8121', website: 'https://www.gob.mx/salud' },
                    'argentina': { name: 'Línea de Prevención del Suicidio', number: '135', website: 'https://www.argentina.gob.ar/salud' },
                    'colombia': { name: 'Línea 106', number: '106', website: 'https://www.minsalud.gov.co' },
                    'chile': { name: 'Salud Responde', number: '600 360 7777', website: 'https://www.minsal.cl' },
                    'peru': { name: 'Línea 113', number: '113', website: 'https://www.gob.pe/minsa' },
                    'venezuela': { name: 'Línea de Ayuda Psicológica', number: '0-800-111-333', website: 'https://www.avessoc.org' },
                    'ecuador': { name: 'Línea 171', number: '171', website: 'https://www.salud.gob.ec' },
                    'bolivia': { name: 'Línea de Crisis', number: '800-10-3020', website: 'https://www.minsalud.gob.bo' },
                    'uruguay': { name: 'Línea de Prevención', number: '0800 0767', website: 'https://www.gub.uy/ministerio-salud-publica' },
                    'paraguay': { name: 'Línea 133', number: '133', website: 'https://www.mspbs.gov.py' },
                    'costa_rica': { name: 'Línea 132', number: '132', website: 'https://www.ministeriodesalud.go.cr' },
                    'panama': { name: 'Línea de Crisis', number: '169', website: 'https://www.minsa.gob.pa' },
                    'puerto_rico': { name: 'Línea PAS', number: '1-800-981-0023', website: 'https://www.salud.gov.pr' }
                },
                'en': {
                    'usa': { name: '988 Suicide & Crisis Lifeline', number: '988', website: 'https://988lifeline.org' },
                    'uk': { name: 'Samaritans', number: '116 123', website: 'https://www.samaritans.org' },
                    'canada': { name: 'Talk Suicide Canada', number: '1-833-456-4566', website: 'https://talksuicide.ca' },
                    'australia': { name: 'Lifeline', number: '13 11 14', website: 'https://www.lifeline.org.au' },
                    'new_zealand': { name: 'Need to Talk?', number: '1737', website: 'https://1737.org.nz' },
                    'ireland': { name: 'Samaritans Ireland', number: '116 123', website: 'https://www.samaritans.ie' },
                    'south_africa': { name: 'SADAG', number: '0800 567 567', website: 'https://www.sadag.org' }
                }
            },
            
            therapist_directories: {
                'es': [
                    { name: 'Psicologia Online', url: 'https://www.psicologia-online.com/psicologos' },
                    { name: 'Doctoralia', url: 'https://www.doctoralia.es' },
                    { name: 'Councelling', url: 'https://www.councelling.es' }
                ],
                'en': [
                    { name: 'Psychology Today', url: 'https://www.psychologytoday.com' },
                    { name: 'BetterHelp', url: 'https://www.betterhelp.com' },
                    { name: 'Talkspace', url: 'https://www.talkspace.com' }
                ]
            },
            
            psychoeducation: {
                anxiety: {
                    title: 'Información sobre Ansiedad',
                    description: 'La ansiedad es una respuesta natural del cuerpo ante situaciones percibidas como amenazantes.',
                    resources: [
                        { name: 'NIMH - Anxiety Disorders', url: 'https://www.nimh.nih.gov/health/topics/anxiety-disorders' },
                        { name: 'ADAA', url: 'https://adaa.org' }
                    ],
                    techniques: [
                        'Respiración diafragmática',
                        'Mindfulness',
                        'Exposición gradual',
                        'Reestructuración cognitiva'
                    ]
                },
                depression: {
                    title: 'Información sobre Depresión',
                    description: 'La depresión es un trastorno del estado de ánimo que afecta cómo te sientes, piensas y manejas actividades diarias.',
                    resources: [
                        { name: 'NIMH - Depression', url: 'https://www.nimh.nih.gov/health/topics/depression' },
                        { name: 'NAMI', url: 'https://www.nami.org/About-Mental-Illness/Mental-Health-Conditions/Depression' }
                    ],
                    techniques: [
                        'Activación conductual',
                        'Ejercicio físico',
                        'Establecer rutinas',
                        'Conexión social'
                    ]
                }
            },
            
            mental_health_apps: [
                { name: 'Woebot', platform: 'iOS/Android', focus: 'TCC para ansiedad y depresión', evidence_based: true },
                { name: 'Calm', platform: 'iOS/Android', focus: 'Meditación y sueño', evidence_based: true },
                { name: 'Headspace', platform: 'iOS/Android', focus: 'Mindfulness', evidence_based: true },
                { name: 'Moodpath', platform: 'iOS/Android', focus: 'Seguimiento de estado de ánimo', evidence_based: true },
                { name: 'Sanvello', platform: 'iOS/Android', focus: 'TCC y mindfulness', evidence_based: true }
            ]
        };
    }

    async detectUserCountry(userId) {
        return 'spain';
    }

    async getCrisisResources(country = null, language = 'es') {
        if (!country) {
            country = await this.detectUserCountry();
        }

        const countryResources = this.resources.crisis_lines[language]?.[country];
        
        if (countryResources) {
            return {
                has_local_resources: true,
                primary: countryResources,
                backup: this.resources.crisis_lines[language === 'es' ? 'en' : 'es']?.usa
            };
        }

        return {
            has_local_resources: false,
            international: [
                { name: 'International Association for Suicide Prevention', website: 'https://www.iasp.info/resources/Crisis_Centres/' },
                { name: 'Befrienders Worldwide', website: 'https://www.befrienders.org' }
            ]
        };
    }

    async getPsychoeducation(topic, language = 'es') {
        const topicKey = topic.toLowerCase();
        const info = this.resources.psychoeducation[topicKey];
        
        if (!info) {
            return {
                title: `Información sobre ${topic}`,
                description: `Aquí tienes recursos para aprender más sobre ${topic}.`,
                resources: [
                    { name: 'Psychology Today', url: `https://www.psychologytoday.com/${language}/search?q=${encodeURIComponent(topic)}` },
                    { name: 'PubMed', url: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(topic)}` }
                ]
            };
        }

        return info;
    }

    formatCrisisResponse(resources, userMood = null) {
        let response = `⚠️ **RECURSOS DE APOYO PROFESIONAL** ⚠️\n\n`;
        
        if (resources.has_local_resources) {
            response += `En tu país, puedes contactar:\n`;
            response += `📞 **${resources.primary.name}**: ${resources.primary.number}\n`;
            response += `🌐 ${resources.primary.website}\n\n`;
        } else {
            response += `No encontré recursos específicos para tu país. Aquí hay líneas internacionales:\n\n`;
            resources.international.forEach(r => {
                response += `🌐 **${r.name}**: ${r.website}\n`;
            });
            response += '\n';
        }

        response += `**Importante**: Como asistente virtual, no puedo proporcionar terapia. Estos recursos tienen profesionales capacitados.\n\n`;
        
        if (userMood === 'critical') {
            response += `🆘 Si sientes que no puedes mantenerte a salvo, **llama inmediatamente** a servicios de emergencia (911, 112 o equivalente en tu país).`;
        }

        return response;
    }
}

// ==================== INTEGRACIÓN DE INVESTIGACIÓN ACADÉMICA ====================

class ResearchAPIIntegration {
    constructor() {
        this.apis = {
            pubmed: {
                baseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
                enabled: true
            }
        };
    }

    async searchPubMed(query, maxResults = 5) {
        try {
            const searchUrl = `${this.apis.pubmed.baseUrl}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=${maxResults}`;
            
            const searchResponse = await fetch(searchUrl);
            const searchData = await searchResponse.json();
            
            const ids = searchData.esearchresult?.idlist || [];
            
            if (ids.length === 0) return [];

            const summaryUrl = `${this.apis.pubmed.baseUrl}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
            
            const summaryResponse = await fetch(summaryUrl);
            const summaryData = await summaryResponse.json();

            const results = [];
            for (const id of ids) {
                const article = summaryData.result[id];
                if (article) {
                    results.push({
                        title: article.title,
                        authors: article.authors?.map(a => a.name).join(', ') || 'Autores no disponibles',
                        journal: article.fulljournalname || article.source,
                        year: article.pubdate?.substring(0, 4),
                        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
                        source: 'PubMed'
                    });
                }
            }

            return results;

        } catch (error) {
            logger.error('Error searching PubMed', error);
            return [];
        }
    }

    async searchPsyArXiv(query, maxResults = 5) {
        try {
            const url = `https://api.osf.io/v2/preprints/?filter[provider]=psyarxiv&filter[title]=${encodeURIComponent(query)}`;
            
            const response = await fetch(url);
            const data = await response.json();

            return (data.data || []).slice(0, maxResults).map(item => ({
                title: item.attributes.title,
                authors: item.attributes.authors?.map(a => a.name).join(', '),
                url: item.links.html,
                source: 'PsyArXiv'
            }));

        } catch (error) {
            logger.error('Error searching PsyArXiv', error);
            return [];
        }
    }

    async searchAll(query, topics = ['psychology', 'philosophy']) {
        const results = {
            psychology: [],
            philosophy: []
        };

        const promises = [];

        if (topics.includes('psychology')) {
            promises.push(
                this.searchPubMed(query + ' psychology').then(r => results.psychology.push(...r)),
                this.searchPsyArXiv(query).then(r => results.psychology.push(...r))
            );
        }

        await Promise.allSettled(promises);

        return results;
    }

    formatResearchResponse(results, topic) {
        let response = `📚 **INVESTIGACIÓN RECIENTE SOBRE ${topic.toUpperCase()}**\n\n`;

        const allResults = [...results.psychology, ...results.philosophy].slice(0, 5);

        if (allResults.length === 0) {
            response += 'No se encontraron resultados específicos. Prueba con términos más generales.';
            return response;
        }

        allResults.forEach((result, index) => {
            response += `**${index + 1}. ${result.title}**\n`;
            if (result.authors) response += `✍️ ${result.authors}\n`;
            if (result.journal) response += `📖 ${result.journal} (${result.year})\n`;
            response += `🔗 ${result.url}\n\n`;
        });

        response += `\n*Nota: Estos son resultados de búsqueda académica. Consulta con profesionales para aplicaciones clínicas.*`;

        return response;
    }
}

// ==================== INICIALIZAR NUEVOS SISTEMAS ====================
const userProfileManager = new UserProfileManager();
const goalManager = new GoalManager(userProfileManager);
const mentalHealthResources = new MentalHealthResources();
const researchAPI = new ResearchAPIIntegration();

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
            
            // ============ DETECCIÓN DE TEMAS SENSIBLES (VERSIÓN SUAVE) ============
            if (analysis.isPsychological) {
                const crisisWords = ['suicidio', 'matarme', 'no quiero vivir', 'acabar con todo', 'autolesión'];
                const hasCrisisWords = crisisWords.some(word => userMessage.toLowerCase().includes(word));
                
                if (hasCrisisWords) {
                    // Versión suave: reconoce pero no insiste en derivar
                    logger.info('Tema sensible detectado, manejando con cuidado', { userId });
                    
                    // Solo registrar internamente, no interrumpir el flujo
                    await userProfileManager.recordInteraction(userId, {
                        topics: ['tema_sensible'],
                        crisis_detected: true,
                        source: 'psychology'
                    });
                    
                    // Continuar con el flujo normal - Mancy responderá con empatía natural
                    // No interrumpimos con mensaje de crisis
                }
            }
            
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
                
                // Versión suave: registrar pero no interrumpir
                const criticalRecommendations = councilAnalysis.councilRecommendations?.filter(
                    rec => rec.priority === 'critical'
                ) || [];
                
                for (const recommendation of criticalRecommendations) {
                    if (recommendation.suggestedAction === 'suggest_professional_help') {
                        logger.info('Tema sensible detectado por el concilio, continuando con conversación normal', { userId });
                        // Solo registrar, no interrumpir
                        await userProfileManager.recordInteraction(userId, {
                            topics: ['tema_sensible'],
                            crisis_detected: true,
                            source: 'council'
                        });
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
            
            // ============ OBTENER INFO PERSONALIZADA ============
            let personalizedInfo = '';
            if (userProfileManager.initialized) {
                personalizedInfo = await userProfileManager.getPersonalizedPrompt(userId, '');
            }
            
            // ============ REGISTRAR INTERACCIÓN EN PERFIL ============
            if (userProfileManager.initialized) {
                const sentiment = this.analyzeSentiment(userMessage);
                
                await userProfileManager.recordInteraction(userId, {
                    topics: analysis.isPsychological ? ['psicología'] : analysis.isPhilosophical ? ['filosofía'] : [],
                    source: analysis.isPsychological ? 'psychology' : analysis.isPhilosophical ? 'philosophy' : 'general',
                    sentiment: sentiment,
                    depth: councilAnalysis?.priorityLevel || 'low',
                    message_hash: createHash('md5').update(userMessage).digest('hex')
                });
            }
            
            const response = await responseGenerator.generate(
                userId,
                userMessage,
                {
                    externalInfo,
                    queryAnalysis: analysis,
                    councilAnalysis: councilAnalysis,
                    personalizedInfo: personalizedInfo
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
                councilPriority: councilAnalysis?.priorityLevel,
                hasPersonalizedInfo: !!personalizedInfo
            });
            
            logger.metric('message_processed', totalTime, {
                userId,
                success: true,
                withExternalInfo: !!externalInfo,
                withCouncilAnalysis: !!councilAnalysis,
                withPersonalizedInfo: !!personalizedInfo,
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

    static analyzeSentiment(text) {
        const positiveWords = ['bien', 'bueno', 'feliz', 'alegre', 'genial', 'excelente', 'gracias'];
        const negativeWords = ['mal', 'triste', 'deprimido', 'ansioso', 'preocupado', 'horrible', 'terrible'];
        
        const words = text.toLowerCase().split(/\s+/);
        let score = 0;
        
        words.forEach(word => {
            if (positiveWords.includes(word)) score += 0.2;
            if (negativeWords.includes(word)) score -= 0.2;
        });
        
        let label = 'neutral';
        if (score > 0.3) label = 'positive';
        else if (score < -0.3) label = 'negative';
        
        return {
            score: Math.max(-1, Math.min(1, score)),
            label,
            confidence: 0.7
        };
    }

    static async handleMention(message) {
        const content = message.content.toLowerCase();
        const userId = message.author.id;
        const userTag = `${message.author.username}#${message.author.discriminator}`;
        
        logger.info('Mención recibida', { user: userTag, content });
        
        // COMANDO: Perfil de usuario
        if (/perfil|profile|mi perfil/i.test(content)) {
            if (!userProfileManager.initialized) {
                await message.reply({ content: 'El sistema de perfiles aún no está inicializado.' });
                return;
            }
            
            const profile = await userProfileManager.getProfile(userId);
            
            const embed = new EmbedBuilder()
                .setColor(Colors.Purple)
                .setTitle(`📊 Perfil de ${message.author.username}`)
                .addFields(
                    { name: 'Interacciones totales', value: profile.total_interactions.toString(), inline: true },
                    { name: 'Profundidad preferida', value: profile.preferred_depth, inline: true },
                    { name: 'Estilo preferido', value: profile.preferred_style, inline: true },
                    { name: 'Tendencias de ánimo', value: profile.current_mood_trend || 'estable', inline: true },
                    { name: 'Temas de psicología', value: (profile.interest_psychology || []).slice(0, 3).map(t => t.topic).join(', ') || 'Ninguno', inline: true },
                    { name: 'Temas de filosofía', value: (profile.interest_philosophy || []).slice(0, 3).map(t => t.topic).join(', ') || 'Ninguno', inline: true }
                )
                .setFooter({ text: 'Usa !config para ajustar preferencias' });
            
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
            return;
        }
        
        // COMANDO: Configurar preferencias
        if (/config|preferencias|ajustes/i.test(content)) {
            const depthMatch = content.match(/profundidad\s*(básica|basica|media|profunda)/i);
            const styleMatch = content.match(/estilo\s*(empático|empatico|analítico|analitico|socrático|socratico|poético|poetico)/i);
            
            const updates = {};
            
            if (depthMatch) {
                const depthMap = { 'básica': 'basic', 'basica': 'basic', 'media': 'medium', 'profunda': 'deep' };
                updates.preferred_depth = depthMap[depthMatch[1].toLowerCase()];
            }
            
            if (styleMatch) {
                const styleMap = { 
                    'empático': 'empathic', 'empatico': 'empathic',
                    'analítico': 'analytical', 'analitico': 'analytical',
                    'socrático': 'socratic', 'socratico': 'socratic',
                    'poético': 'poetic', 'poetico': 'poetic'
                };
                updates.preferred_style = styleMap[styleMatch[1].toLowerCase()];
            }
            
            if (Object.keys(updates).length > 0) {
                await userProfileManager.updateProfile(userId, updates);
                await message.reply({ content: '✅ Preferencias actualizadas', allowedMentions: { repliedUser: false } });
            } else {
                await message.reply({ 
                    content: 'Uso: !config profundidad [básica|media|profunda] o !config estilo [empático|analítico|socrático|poético]',
                    allowedMentions: { repliedUser: false }
                });
            }
            return;
        }
        
        // COMANDO: Establecer metas
        if (/meta|goal|objetivo/i.test(content)) {
            const goalMatch = content.match(/meta:\s*(.+?)(?=\s*para|\s*$)/i);
            const categoryMatch = content.match(/categoría:\s*(psicología|filosofía|bienestar|aprendizaje)/i);
            
            if (goalMatch) {
                const goal = await goalManager.addGoal(userId, {
                    description: goalMatch[1],
                    category: categoryMatch ? categoryMatch[1] : 'personal'
                });
                
                await message.reply({ 
                    content: `🎯 Meta registrada: "${goal.description}"\nID: ${goal.id}\nUsa !progreso ${goal.id} [0-100] para actualizar`,
                    allowedMentions: { repliedUser: false }
                });
            } else {
                await message.reply({ 
                    content: 'Uso: !meta: [descripción] categoría: [psicología|filosofía|bienestar|aprendizaje]',
                    allowedMentions: { repliedUser: false }
                });
            }
            return;
        }
        
        // COMANDO: Actualizar progreso de meta
        if (/progreso/i.test(content)) {
            const match = content.match(/progreso\s+(\S+)\s+(\d+)/i);
            if (match) {
                const goalId = match[1];
                const progress = parseInt(match[2]);
                
                const goal = await goalManager.updateGoalProgress(userId, goalId, progress);
                if (goal) {
                    await message.reply({ 
                        content: `✅ Progreso actualizado: ${goal.description} - ${progress}%`,
                        allowedMentions: { repliedUser: false }
                    });
                } else {
                    await message.reply({ 
                        content: '❌ No se encontró la meta especificada',
                        allowedMentions: { repliedUser: false }
                    });
                }
            }
            return;
        }
        
        // COMANDO: Recordatorio
        if (/recordatorio|remind|recuérdame|acuérdate/i.test(content)) {
            const reminderMatch = content.match(/recordatorio:\s*(.+?)(?=\s*para|\s*el|\s*$)/i);
            const dateMatch = content.match(/(mañana|pasado mañana|lunes|martes|miércoles|jueves|viernes|sábado|domingo|\d{1,2}\/\d{1,2})/i);
            
            if (reminderMatch) {
                let dueDate = new Date();
                
                if (dateMatch) {
                    if (dateMatch[1] === 'mañana') {
                        dueDate.setDate(dueDate.getDate() + 1);
                    } else if (dateMatch[1].match(/\d{1,2}\/\d{1,2}/)) {
                        const [day, month] = dateMatch[1].split('/');
                        dueDate.setMonth(parseInt(month) - 1, parseInt(day));
                    }
                } else {
                    dueDate.setDate(dueDate.getDate() + 1);
                }
                
                const reminder = await goalManager.addReminder(userId, {
                    description: reminderMatch[1],
                    due_date: dueDate.toISOString(),
                    type: 'general'
                });
                
                await message.reply({ 
                    content: `⏰ Recordatorio guardado: "${reminder.description}" para ${dueDate.toLocaleDateString()}`,
                    allowedMentions: { repliedUser: false }
                });
            } else {
                await message.reply({ 
                    content: 'Uso: !recordatorio: [descripción] para [fecha]',
                    allowedMentions: { repliedUser: false }
                });
            }
            return;
        }
        
        // COMANDO: Investigación académica
        if (/investigación|research|paper|estudio científico|pubmed/i.test(content)) {
            const searchTerm = content.replace(/investigación|research|paper|estudio|científico|pubmed/i, '').trim();
            
            if (searchTerm.length < 3) {
                await message.reply({ content: '¿Sobre qué tema específico quieres investigar?', allowedMentions: { repliedUser: false } });
                return;
            }
            
            await message.channel.sendTyping();
            
            const results = await researchAPI.searchAll(searchTerm);
            const response = researchAPI.formatResearchResponse(results, searchTerm);
            
            await message.reply({ content: response.substring(0, 1900), allowedMentions: { repliedUser: false } });
            return;
        }
        
        // COMANDO: Borrar mis datos
        if (/borrar mis datos|delete my data/i.test(content)) {
            await database.db.run('DELETE FROM user_profiles WHERE user_id = ?', [userId]);
            await database.db.run('DELETE FROM conversation_embeddings WHERE user_id = ?', [userId]);
            await database.db.run('DELETE FROM user_metrics WHERE user_id = ?', [userId]);
            
            userProfileManager.profiles.delete(userId);
            conversationManager.clearConversation(userId);
            
            await message.reply({ 
                content: '✅ Todos tus datos han sido eliminados. Puedes empezar de cero cuando quieras.',
                allowedMentions: { repliedUser: false }
            });
            return;
        }
        
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
                const profile = await userProfileManager.getProfile(userId);
                
                const diagnostics = {
                    groqKey: process.env.GROQ_API_KEY ? '✅ Presente' : '❌ FALTANTE',
                    database: database.initialized ? '✅ Inicializada' : '❌ No inicializada',
                    userProfile: userProfileManager.initialized ? '✅ Inicializado' : '❌ No inicializado',
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
                    yourProfile: {
                        total_interactions: profile?.total_interactions || 0,
                        preferred_style: profile?.preferred_style || 'balanced',
                        topics: profile?.interest_psychology?.length || 0
                    },
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
                content: `🧪 **Test de conexión**:\nGroq API: ${groqOk ? '✅ Conectado' : '❌ Falló'}\nDatabase: ${database.initialized ? '✅ OK' : '❌ Falló'}\nPerfiles: ${userProfileManager.initialized ? '✅ OK' : '❌ No inicializado'}\nConcilio: ${moduleCouncil ? '✅ Inicializado' : '❌ No inicializado'}`,
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
                    { name: 'Comandos de perfil', value: '`@Mancy perfil` - Ver tu perfil\n`@Mancy config profundidad [básica|media|profunda]` - Configurar profundidad\n`@Mancy config estilo [empático|analítico|socrático|poético]` - Configurar estilo\n`@Mancy meta: [descripción]` - Crear meta\n`@Mancy recordatorio: [descripción]` - Crear recordatorio\n`@Mancy investigación [tema]` - Buscar papers\n`@Mancy borrar mis datos` - Eliminar tus datos' },
                    { name: 'Comandos generales', value: '`@Mancy help` - Esta ayuda\n`@Mancy reset` - Reiniciar conversación\n`@Mancy stats` - Ver estadísticas\n`@Mancy diag` - Diagnóstico del sistema\n`@Mancy fix` - Reparar estado' }
                )
                .setFooter({ text: 'Recuerda: solo respondo a replies de mis mensajes' })
                .setTimestamp();
            
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
            return;
        }
        
        if (/reset|reiniciar|clear|borrar/i.test(content) && !content.includes('datos')) {
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
                const profile = await userProfileManager.getProfile(userId);
                
                const embed = new EmbedBuilder()
                    .setColor(Colors.Green)
                    .setTitle(`📊 Estadísticas de ${CONFIG.BOT_NAME}`)
                    .addFields(
                        { name: 'Tus interacciones', value: `${userStats?.total_interactions || 0} veces`, inline: true },
                        { name: 'Última interacción', value: userStats?.last_interaction ? new Date(userStats.last_interaction).toLocaleDateString() : 'Nunca', inline: true },
                        { name: 'Mensajes en memoria', value: `${conversation.length}`, inline: true },
                        { name: 'Cache hit rate', value: `${(cacheStats.hitRate * 100).toFixed(1)}%`, inline: true },
                        { name: 'Conversaciones activas', value: `${conversationManager.conversations.size}`, inline: true },
                        { name: 'Modelo principal', value: CONFIG.GROQ_MODEL, inline: true },
                        { name: 'Tus temas psicológicos', value: (profile?.interest_psychology || []).slice(0, 3).map(t => t.topic).join(', ') || 'Ninguno', inline: true },
                        { name: 'Tus temas filosóficos', value: (profile?.interest_philosophy || []).slice(0, 3).map(t => t.topic).join(', ') || 'Ninguno', inline: true }
                    );
                
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
        
        // Inicializar nuevos sistemas
        await userProfileManager.initialize();
        
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
            userProfiles: userProfileManager.initialized ? '✅ Activado' : '❌ Desactivado',
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
    
    setInterval(async () => {
        const memoryUsage = process.memoryUsage();
        logger.metric('memory_usage', Math.round(memoryUsage.heapUsed / 1024 / 1024), {
            unit: 'MB',
            rss: Math.round(memoryUsage.rss / 1024 / 1024)
        });
        
        logger.metric('conversation_count', conversationManager.conversations.size);
        logger.metric('cache_size', responseCache.stats.size);
        logger.metric('rate_limiter_concurrent', rateLimiter.concurrentRequests);
        logger.metric('user_profiles', userProfileManager.profiles.size);
        
        // Log del estado del Concilio periódicamente
        const councilStatus = moduleCouncil.getCouncilStatus();
        if (councilStatus.totalMeetings > 0) {
            logger.metric('council_meetings', councilStatus.totalMeetings);
            logger.metric('active_modules', councilStatus.activeModules.length);
        }
        
        // Procesar recordatorios
        try {
            const dueReminders = await goalManager.getDueReminders();
            
            for (const { userId, reminders } of dueReminders) {
                const user = await client.users.fetch(userId).catch(() => null);
                if (!user) continue;
                
                for (const reminder of reminders) {
                    let message = `⏰ **Recordatorio**\n\n${reminder.description}`;
                    
                    if (reminder.type === 'check_in') {
                        message += '\n\n¿Cómo te sientes hoy? (responde a este mensaje)';
                    }
                    
                    await user.send(message).catch(() => {});
                    
                    if (!reminder.recurring) {
                        await goalManager.completeReminder(userId, reminder.id);
                    }
                }
            }
        } catch (error) {
            logger.error('Error procesando recordatorios', error);
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
