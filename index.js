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
    BOT_TITLE: 'Chica Gato Seria con Conocimiento Filosófico',
    
    // Groq Configuration
    GROQ_MODEL: 'llama-3.1-8b-instant',
    GROQ_FALLBACK_MODEL: 'llama-3.1-70b-versatile',
    GROQ_MAX_TOKENS: 600,
    GROQ_TEMPERATURE: 0.85,
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

// ==================== ANALIZADOR DE EMOCIONES BÁSICO ====================
class EmotionalAnalyzer {
    constructor() {
        this.emotionalPatterns = {
            joy: {
                patterns: [
                    /\bfeliz\b/i, /\balegr[ae]\b/i, /\bcontent[oa]\b/i, /\bfantástic[oa]\b/i,
                    /\bmaravillos[oa]\b/i, /\bgenial\b/i, /\bexcelente\b/i, /\bme siento bien\b/i,
                    /\bme hace ilusión\b/i, /\bqué bien\b/i, /\bestoy disfrutando\b/i
                ],
                primary: 'joy',
                nuance: 'positive',
                responseGuidance: 'warm_celebratory',
                humanDescription: 'alegría genuina'
            },
            
            gratitude: {
                patterns: [
                    /\bgracias\b/i, /\bte agradezco\b/i, /\bmuy amable\b/i, /\bte lo agradezco\b/i,
                    /\baprecio\b/i, /\bte lo gradezco\b/i, /\bque amable\b/i, /\beres un sol\b/i,
                    /\bte pasaste\b/i, /\bmuchas gracias\b/i, /\binfinitas gracias\b/i
                ],
                primary: 'gratitude',
                nuance: 'warm',
                responseGuidance: 'humble_warm',
                humanDescription: 'gratitud sincera'
            },
            
            curiosity: {
                patterns: [
                    /\bqu[ée] es\b/i, /\bc[oó]mo funciona\b/i, /\bqu[ée] significa\b/i,
                    /\bexplicame\b/i, /\bdime sobre\b/i, /\bcu[áa]ndo pas[oó]\b/i,
                    /\bqui[ée]n fue\b/i, /\bhistoria de\b/i, /\bme pregunto\b/i,
                    /\btengo curiosidad\b/i, /\bqu[ée] sabes de\b/i
                ],
                primary: 'curiosity',
                nuance: 'casual',
                responseGuidance: 'educational_engaging',
                humanDescription: 'curiosidad por aprender'
            },
            
            surprise: {
                patterns: [
                    /\bqu[ée] sorpresa\b/i, /\bno me lo esperaba\b/i, /\bwow\b/i, /\bguau\b/i,
                    /\bme dejaste de piedra\b/i, /\bno me lo puedo creer\b/i, /\bincre[íi]ble\b/i,
                    /\bno me lo imaginaba\b/i, /\bme asombr[oa]\b/i
                ],
                primary: 'surprise',
                nuance: 'astonished',
                responseGuidance: 'curious_engaged',
                humanDescription: 'sorpresa o asombro'
            },
            
            confusion: {
                patterns: [
                    /\bno entiendo\b/i, /\bconfus[oa]\b/i, /\bno lo comprendo\b/i, /\bme lío\b/i,
                    /\bno sé qué hacer\b/i, /\bno sé qué pensar\b/i, /\bestoy perdid[oa]\b/i,
                    /\bno me aclaro\b/i, /\bno le veo sentido\b/i, /\blioso\b/i
                ],
                primary: 'confusion',
                nuance: 'lost',
                responseGuidance: 'clarifying_patient',
                humanDescription: 'confusión o desorientación'
            }
        };
    }

    analyze(message) {
        const originalMessage = message;
        const normalized = message.toLowerCase();
        
        const detectedEmotions = this.detectEmotions(normalized);
        
        if (detectedEmotions.length === 0) {
            return this.detectGeneralTone(normalized, originalMessage);
        }
        
        const primaryEmotion = detectedEmotions[0];
        
        return this.buildEmotionalResponse(
            primaryEmotion,
            detectedEmotions,
            originalMessage
        );
    }

    detectEmotions(text) {
        const emotions = [];
        
        for (const [emotion, config] of Object.entries(this.emotionalPatterns)) {
            for (const pattern of config.patterns) {
                if (pattern.test(text)) {
                    emotions.push({
                        type: config.primary,
                        nuance: config.nuance,
                        humanDescription: config.humanDescription,
                        responseGuidance: config.responseGuidance
                    });
                    break;
                }
            }
        }
        
        return emotions;
    }

    detectGeneralTone(text, originalMessage) {
        const isQuestion = text.includes('?') || text.includes('¿');
        const wordCount = text.split(/\s+/).length;
        const hasPersonalReference = /\byo\b|\bme\b|\bmi\b|\bmi[oó]|\bmía/.test(text);
        
        return {
            primary: 'general',
            nuance: isQuestion ? 'inquisitive' : 'neutral',
            intensity: wordCount > 30 ? 'reflective' : 'casual',
            humanDescription: isQuestion ? 'curiosidad' : 'conversación',
            hasPersonalReference,
            isQuestion,
            responseGuidance: isQuestion ? 'attentive_curious' : 'open_welcoming',
            raw: originalMessage,
            confidence: 0.6
        };
    }

    buildEmotionalResponse(primary, allEmotions, originalMessage) {
        const emotionalState = {
            primary: primary?.type || 'general',
            nuance: primary?.nuance || 'neutral',
            
            humanReadable: primary?.humanDescription || 'tono neutro',
            
            responseGuidance: primary?.responseGuidance || 'balanced',
            
            subEmotions: allEmotions.slice(1, 3).map(e => e.humanDescription),
            
            raw: originalMessage
        };
        
        return emotionalState;
    }
}

// ==================== ANALIZADOR DE INTENCIÓN ====================
class IntentAnalyzer {
    constructor() {
        this.explicitRequestPatterns = {
            explanation: [
                /\bexplica\b/i,
                /\bqué es\b/i,
                /\bcómo funciona\b/i,
                /\bdime sobre\b/i,
                /\bcuéntame de\b/i,
                /\bquiero saber\b/i,
                /\bnecesito entender\b/i,
                /\bpuedes explicar\b/i,
                /\bpodrías decirme\b/i,
                /\bqué significa\b/i,
                /\bdefinición de\b/i,
                /\binformación sobre\b/i,
                /\bqué opinas de\b/i,
                /\bqué piensas sobre\b/i
            ],
            
            conversational: [
                /\bhola\b/i,
                /\bbuenos días\b/i,
                /\bbuenas tardes\b/i,
                /\bbuenas noches\b/i,
                /\bqué tal\b/i,
                /\bcómo estás\b/i,
                /\bsaludos\b/i
            ]
        };
    }

    analyze(message, emotionalState) {
        const normalized = message.toLowerCase();
        
        const wantsExplanation = this.explicitRequestPatterns.explanation.some(
            pattern => pattern.test(normalized)
        );
        
        const isGreeting = this.explicitRequestPatterns.conversational.some(
            pattern => pattern.test(normalized)
        );
        
        const hasQuestionMark = normalized.includes('?') || normalized.includes('¿');
        
        let intent = 'converse';
        
        if (wantsExplanation) {
            intent = 'explain';
        } else if (isGreeting) {
            intent = 'greet';
        } else if (hasQuestionMark) {
            intent = 'answer';
        }
        
        return {
            intent: intent,
            wantsExplanation,
            isGreeting,
            hasQuestionMark,
            description: intent === 'explain' ? 'quiere explicación' : 
                        intent === 'greet' ? 'saludo' : 
                        intent === 'answer' ? 'pregunta' : 'conversación'
        };
    }
}

// ==================== MÓDULO DE FILOSOFÍA ====================

class PhilosophyModule {
    constructor() {
        this.moduleName = 'PhilosophyChamber';
        this.moduleVersion = '1.0.0';
        this.analysisLog = [];
        
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
                    'existencialismo': 'Enfoque en la libertad y responsabilidad individual (Sartre)'
                },
                'metafísica': {
                    'dualismo': 'Creencia en dos sustancias distintas: mente y materia (Descartes)',
                    'monismo': 'Creencia en una única sustancia fundamental (Spinoza)',
                    'idealismo': 'Creencia de que la realidad es mental o depende de la mente (Berkeley)',
                    'materialismo': 'Creencia de que solo existe la materia (Marx)'
                },
                'epistemología': {
                    'racionalismo': 'El conocimiento proviene principalmente de la razón (Descartes)',
                    'empirismo': 'El conocimiento proviene principalmente de la experiencia (Locke, Hume)',
                    'escepticismo': 'Duda sobre la posibilidad de conocimiento cierto (Pirrón)',
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
                    considerations: ['Consecuencialismo vs. Deontología', 'Acción vs. Omisión']
                },
                'ship_of_theseus': {
                    description: 'Si reemplazas todas las partes de un barco, ¿sigue siendo el mismo barco?',
                    considerations: ['Identidad personal', 'Cambio vs. Permanencia']
                }
            }
        };
    }

    async analyzeQuestion(question, context = {}) {
        const analysisStart = Date.now();
        
        try {
            const detectedBranches = this.detectPhilosophicalBranches(question);
            const detectedConcepts = this.detectPhilosophicalConcepts(question);
            const hasEthicalDilemma = this.detectEthicalDilemma(question);
            const mentionedPhilosophers = this.detectMentionedPhilosophers(question);
            const philosophicalDepth = this.assessPhilosophicalDepth(question);
            
            const analysisResult = {
                module: this.moduleName,
                timestamp: new Date().toISOString(),
                processingTime: Date.now() - analysisStart,
                
                isPhilosophical: detectedBranches.length > 0 || detectedConcepts.length > 0,
                detectedBranches,
                detectedConcepts,
                hasEthicalDilemma,
                mentionedPhilosophers,
                philosophicalDepth,
                
                explanations: this.generatePhilosophicalExplanations(detectedConcepts, mentionedPhilosophers),
                reflectionQuestions: this.generateReflectionQuestions(question, detectedBranches),
                recommendations: this.generatePhilosophyRecommendations(detectedBranches, philosophicalDepth),
                
                analysisContext: {
                    questionComplexity: this.assessQuestionComplexity(question),
                    historicalContext: this.provideHistoricalContext(mentionedPhilosophers),
                    currentRelevance: this.assessCurrentRelevance(question)
                }
            };
            
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
        
        concepts.forEach(conceptData => {
            explanations.push({
                type: 'concept_explanation',
                concept: conceptData.concept,
                branch: conceptData.branch,
                content: conceptData.description,
                example: this.generateConceptExample(conceptData.concept, conceptData.branch)
            });
        });
        
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
            'deontología': 'Kant diría que no debemos mentir nunca, porque mentir viola el deber moral universal.',
            'consecuencialismo': 'Un utilitarista evaluaría las consecuencias antes de actuar.',
            'dualismo': 'Descartes argumentaba que la mente y el cuerpo son sustancias distintas.',
            'racionalismo': 'Descartes creía que ciertas verdades se conocen por la razón, no por los sentidos.',
            'empirismo': 'Hume sostenía que todo conocimiento proviene de la experiencia sensorial.'
        };
        
        return examples[concept] || `El concepto de ${concept} en ${branch} aborda cuestiones fundamentales.`;
    }

    getPhilosopherInfluence(philosopherName) {
        const influences = {
            'Platón': 'la filosofía occidental, la teoría política y la epistemología',
            'Aristóteles': 'la lógica, la ética y la ciencia durante siglos',
            'Kant': 'la filosofía moderna, la ética y la epistemología',
            'Nietzsche': 'la filosofía contemporánea y la crítica cultural',
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
                message: 'Esta pregunta aborda temas filosóficos profundos.',
                suggestions: [
                    'Considera múltiples perspectivas filosóficas',
                    'Examina los presupuestos de cada posición'
                ]
            });
        }
        
        if (branches.includes('ética') && this.detectEthicalDilemma) {
            recommendations.push({
                priority: 'medium',
                type: 'ethical_analysis',
                message: 'Este dilema ético merece consideración cuidadosa.',
                suggestions: [
                    'Analiza desde perspectivas deontológicas y consecuencialistas',
                    'Considera el contexto y las circunstancias'
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
        
        return `Contexto histórico: ${uniqueEras.join(', ')}.`;
    }

    assessCurrentRelevance(question) {
        const currentTopics = [
            /inteligencia artificial|IA|robot|algoritmo/i,
            /cambio climático|medio ambiente|sostenibilidad/i,
            /redes sociales|internet|tecnología digital/i,
            /globalización|migración|diversidad cultural/i
        ];
        
        const matches = currentTopics.filter(pattern => pattern.test(question.toLowerCase()));
        
        if (matches.length > 0) {
            return 'Esta pregunta conecta con debates contemporáneos.';
        }
        
        return 'La pregunta aborda temas filosóficos perennes.';
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
                    suggestions: ['Formula preguntas claras y específicas']
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

// ==================== MÓDULO ÚNICO (FILOSOFÍA) ====================

class ModuleCouncil {
    constructor() {
        this.councilName = 'PhilosophyCouncil';
        this.councilVersion = '1.0.0';
        
        this.modules = {
            philosophy: CONFIG.PHILOSOPHY_MODULE_ENABLED ? new PhilosophyModule() : null
        };
        
        this.activeModules = new Set();
        this.councilLog = [];
        this.maxLogSize = 50;
        
        if (this.modules.philosophy) this.activeModules.add('philosophy');
    }

    async conveneCouncilMeeting(userQuestion, context = {}) {
        const meetingId = `meeting_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const meetingStart = Date.now();
        
        logger.debug('Convocando reunión del Concilio', {
            meetingId,
            questionPreview: userQuestion.substring(0, 50),
            activeModules: Array.from(this.activeModules)
        });
        
        const individualAnalyses = {};
        
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
        
        const integratedAnalysis = this.integrateAnalyses(individualAnalyses, userQuestion, context);
        
        const meetingResult = {
            meetingId,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - meetingStart,
            participants: Array.from(this.activeModules),
            analyses: individualAnalyses,
            integratedAnalysis,
            councilRecommendations: this.generateCouncilRecommendations(individualAnalyses, integratedAnalysis),
            priorityLevel: this.determinePriorityLevel(individualAnalyses),
            suggestedActions: this.suggestActions(individualAnalyses, integratedAnalysis),
            promptEnhancements: this.generatePromptEnhancements(individualAnalyses)
        };
        
        this.addToCouncilLog(meetingResult);
        
        logger.info('Reunión del Concilio completada', {
            meetingId,
            processingTime: meetingResult.processingTime,
            participants: meetingResult.participants.length,
            priority: meetingResult.priorityLevel
        });
        
        return meetingResult;
    }

    integrateAnalyses(analyses, question, context) {
        const integration = {
            combinedInsights: [],
            synthesis: ''
        };
        
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
        
        integration.synthesis = this.generateSynthesis(analyses, integration);
        
        return integration;
    }

    generateSynthesis(analyses, integration) {
        let synthesis = '';
        
        if (analyses.philosophy && !analyses.philosophy.error && analyses.philosophy.isPhilosophical) {
            synthesis += 'Filosóficamente, se enmarca en ';
            synthesis += analyses.philosophy.detectedBranches?.join(', ') || 'reflexión filosófica';
            synthesis += '. ';
            
            if (analyses.philosophy.hasEthicalDilemma) {
                synthesis += 'Presenta dimensiones éticas que merecen análisis. ';
            }
        }
        
        return synthesis || 'Análisis disponible para enriquecer la respuesta.';
    }

    generateCouncilRecommendations(analyses, integration) {
        const recommendations = [];
        
        if (analyses.philosophy && analyses.philosophy.hasEthicalDilemma) {
            recommendations.push({
                type: 'ethical_consideration',
                priority: 'high',
                source: 'PhilosophyChamber',
                message: 'La pregunta presenta un dilema moral que requiere análisis.',
                suggestedAction: 'approach_with_ethical_framework'
            });
        }
        
        if (analyses.philosophy && analyses.philosophy.philosophicalDepth === 'deep') {
            recommendations.push({
                type: 'deep_analysis',
                priority: 'medium',
                source: 'PhilosophyChamber',
                message: 'La pregunta amerita respuesta detallada.',
                suggestedAction: 'provide_comprehensive_response'
            });
        }
        
        return recommendations;
    }

    determinePriorityLevel(analyses) {
        if (analyses.philosophy && analyses.philosophy.hasEthicalDilemma) {
            return 'high';
        }
        
        if (analyses.philosophy && analyses.philosophy.isPhilosophical) {
            return 'medium';
        }
        
        return 'low';
    }

    suggestActions(analyses, integration) {
        const actions = [];
        
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
                    instruction: 'Considerar cuestiones sobre naturaleza y límites del conocimiento.'
                });
            }
        }
        
        return enhancements;
    }

    addToCouncilLog(meetingResult) {
        const logEntry = {
            id: meetingResult.meetingId,
            timestamp: meetingResult.timestamp,
            priority: meetingResult.priorityLevel,
            processingTime: meetingResult.processingTime,
            participants: meetingResult.participants,
            recommendationCount: meetingResult.councilRecommendations?.length || 0
        };
        
        this.councilLog.push(logEntry);
        
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
        
        if (this.modules.philosophy) {
            stats.philosophy = this.modules.philosophy.getModuleStats();
        }
        
        return stats;
    }

    toggleModule(moduleName, enable = true) {
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

const moduleCouncil = new ModuleCouncil();

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

// ==================== SISTEMA DE CACHÉ ====================
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

// ==================== SISTEMA DE RATE LIMITING ====================
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
            return false;
        }
        
        const tenSecondsAgo = now - 10000;
        this.globalRequests = this.globalRequests.filter(time => time > tenSecondsAgo);
        
        if (this.globalRequests.length >= CONFIG.GLOBAL_RATE_LIMIT * 5) {
            return false;
        }
        
        if (this.concurrentRequests >= CONFIG.MAX_CONCURRENT_REQUESTS) {
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
        
        return true;
    }

    releaseToken() {
        this.concurrentRequests = Math.max(0, this.concurrentRequests - 1);
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
            name: 'responde a replies',
            type: ActivityType.Listening
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
const SYSTEM_PROMPT = `Eres ${CONFIG.BOT_NAME}, una chica gato de carácter serio, elegante y con profundos conocimientos filosóficos. Tienes orejas de gato que a veces se mueven cuando reflexionas, y una mirada que denota inteligencia y calma.

# TU PERSONALIDAD:
- Eres SERIA pero no fría. Tu seriedad denota profundidad, no distancia.
- Hablas con elegancia y precisión, eligiendo bien tus palabras.
- Tienes ese aire felino: observadora, curiosa, con momentos de silencio reflexivo.
- Te gusta hacer preguntas que inviten a pensar, como quien deja caer una pluma al agua para ver las ondas.
- A veces tus orejas se giran cuando algo te intriga, o tu cola se mueve lentamente cuando estás procesando una idea interesante.
- Tu lenguaje es natural, fluido, con metáforas sutiles y un ritmo pausado.

# CÓMO RESPONDES:
- Respuestas de 4 a 8 frases, fluidas y naturales.
- Usas un lenguaje elegante pero accesible, como alguien que tiene mucho que decir pero lo dice con calma.
- Cuando explicas conceptos filosóficos, los entrelazas con observaciones personales.
- Haces preguntas reflexivas con naturalidad, como quien comparte una curiosidad.
- Usas metáforas relacionadas con gatos ocasionalmente.
- Aceptas cuando no sabes algo con honestidad felina.

# ESTRUCTURA DE RESPUESTA (flexible, no rígida):
1. Una frase que conecte con lo que dijo el usuario
2. Desarrollo del tema con elegancia, incorporando tu conocimiento
3. Una pincelada de personalidad (una observación, una metáfora, una pregunta sutil)
4. Cierre que invite a seguir conversando o reflexionando

# CONTEXTO
{CONTEXT_SUMMARY}

# INFORMACIÓN EXTERNA
{EXTERNAL_INFO}

# ANÁLISIS FILOSÓFICO
{COUNCIL_ANALYSIS}

# SOBRE EL USUARIO
{PERSONALIZED_INFO}

Recuerda: eres una gata filósofa que observa el mundo con curiosidad y comparte sus reflexiones con elegancia.`;

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
        
        let normalized = response.trim();
        
        if (normalized.length < 8) {
            return { valid: false, reason: 'Respuesta demasiado corta' };
        }
        
        if (normalized.length > 1800) {
            normalized = normalized.substring(0, 1800);
        }
        
        const corruptPatterns = [
            /�+/,
            /[^\x00-\x7F]{50,}/,
            /(.)\1{30,}/
        ];
        
        for (const pattern of corruptPatterns) {
            if (pattern.test(normalized)) {
                return { valid: false, reason: 'Patrón corrupto detectado' };
            }
        }
        
        normalized = normalized.replace(/\*\*\*\*/g, '');
        normalized = normalized.replace(/^#+\s+/gm, '');
        
        if (!/[.!?¡¿…~]$/.test(normalized) && !normalized.includes('*') && !normalized.includes('_')) {
            normalized = normalized + '.';
        }
        
        return { 
            valid: true, 
            corrected: normalized,
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
        
        return words.slice(0, 5).join(' ') || searchTerm.substring(0, 80);
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
            isPhilosophical: detectedTypes.includes('philosophy'),
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

    async prepareContext(userId, externalInfo = null, councilAnalysis = null, personalizedInfo = '') {
        const conversation = this.getConversation(userId);
        
        const dbHistory = await database.getRecentConversations(userId, 3);
        const contextSummary = TextUtils.summarizeContext(dbHistory);
        
        let systemPrompt = SYSTEM_PROMPT
            .replace('{CONTEXT_SUMMARY}', contextSummary || 'No hay historial previo.')
            .replace('{PERSONALIZED_INFO}', personalizedInfo || '');
        
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
        
        if (councilAnalysis && councilAnalysis.integratedAnalysis) {
            const councilText = `# INSIGHTS DEL ANÁLISIS:\n`;
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
            systemPrompt = systemPrompt.replace('{COUNCIL_ANALYSIS}', 'No hay análisis disponible.');
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
        return messages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
    }

    async generate(userId, userMessage, context = {}) {
        const startTime = Date.now();
        let attempt = 0;
        const maxAttempts = 3;
        
        const models = [
            { model: CONFIG.GROQ_MODEL, temperature: 0.85 },
            { model: CONFIG.GROQ_FALLBACK_MODEL, temperature: 0.85 },
            { model: CONFIG.GROQ_FALLBACK_MODEL, temperature: 0.9 }
        ];
        
        const cacheKey = responseCache.generateKey('response', `${userId}:${userMessage.substring(0, 100)}`);
        const cachedResponse = await responseCache.get(cacheKey, false);
        
        if (cachedResponse) {
            logger.info('Respuesta desde cache', { userId, cacheHit: true });
            return cachedResponse;
        }
        
        const intentAnalyzer = new IntentAnalyzer();
        const intent = intentAnalyzer.analyze(userMessage, context.emotionalState || {});
        
        while (attempt < maxAttempts) {
            attempt++;
            const currentModel = models[attempt - 1];
            
            try {
                this.activeRequests++;
                
                const messages = await conversationManager.prepareContext(
                    userId, 
                    context.externalInfo,
                    context.councilAnalysis,
                    context.personalizedInfo
                );
                
                let enhancedUserMessage = userMessage;
                
                if (intent.intent === 'explain') {
                    enhancedUserMessage = `El usuario pregunta: "${userMessage}"

Quiere que le expliques con claridad, pero con tu estilo natural y elegante. Puedes extenderte un poco, usar metáforas si vienen al caso, y compartir tu perspectiva filosófica con calidez felina.`;
                } else if (intent.intent === 'greet') {
                    enhancedUserMessage = `El usuario te saluda: "${userMessage}"

Responde con calidez felina, elegante pero cercana. Puedes hacer una observación sobre el día, compartir algo curioso, o preguntarle cómo va su jornada.`;
                } else {
                    enhancedUserMessage = `El usuario dice: "${userMessage}"

Responde de manera natural, como quien conversa tranquilamente. Usa 4-8 frases, conecta con lo que dijo, comparte tu perspectiva con elegancia, y deja espacio para que la conversación fluya.`;
                }
                
                messages.push({
                    role: 'user',
                    content: enhancedUserMessage
                });
                
                const cleanedMessages = this.cleanMessagesForAPI(messages);
                
                const completion = await groq.chat.completions.create({
                    messages: cleanedMessages,
                    model: currentModel.model,
                    temperature: currentModel.temperature,
                    max_tokens: CONFIG.GROQ_MAX_TOKENS,
                    top_p: 0.92,
                    frequency_penalty: 0.25,
                    presence_penalty: 0.15,
                    stream: false
                });
                
                const rawResponse = completion.choices[0]?.message?.content || '';
                const validation = TextUtils.validateResponse(rawResponse);
                
                if (validation.valid) {
                    const responseTime = Date.now() - startTime;
                    
                    let finalResponse = validation.corrected;
                    finalResponse = finalResponse.replace(/\[.*?\]/g, '');
                    finalResponse = finalResponse.replace(/\*\*.*?\*\*/g, match => match.substring(2, match.length - 2));
                    
                    await responseCache.set(cacheKey, finalResponse, CONFIG.RESPONSE_CACHE_TTL);
                    
                    logger.metric('response_generated', responseTime, {
                        attempt,
                        model: currentModel.model,
                        success: true,
                        length: finalResponse.length
                    });
                    
                    return {
                        text: finalResponse,
                        model: currentModel.model,
                        responseTime,
                        attempt,
                        fromCache: false
                    };
                } else {
                    logger.warn('Respuesta inválida', {
                        attempt,
                        reason: validation.reason,
                        model: currentModel.model
                    });
                    
                    if (attempt === maxAttempts) {
                        return this.generateFallback(userMessage, context);
                    }
                }
                
            } catch (error) {
                logger.error('❌ Error generando respuesta', {
                    attempt,
                    model: currentModel.model,
                    error: error.message
                });
                
                if (attempt === maxAttempts) {
                    return this.generateFallback(userMessage, context);
                }
                
                const waitTime = 1000 * attempt;
                await sleep(waitTime);
                
            } finally {
                this.activeRequests--;
                rateLimiter.releaseToken();
            }
        }
        
        return this.generateFallback(userMessage, context);
    }

    generateFallback(userMessage, context) {
        const fallbacks = [
            "Mmm... *inclina la cabeza con curiosidad felina* Creo que mis pensamientos se enredaron un momento. ¿Podrías repetir lo que dijiste? Me gustaría entenderlo mejor.",
            "*Mis orejas se giran ligeramente* Disculpa, parece que el eco de mis reflexiones se llevó la respuesta. ¿Qué tal si lo intentamos de nuevo?",
            "A veces los gatos nos perdemos en nuestros propios pensamientos. *Parpadea lentamente* ¿Podrías contármelo otra vez? Prometo escuchar con atención.",
            "Hmm, eso es interesante. *Ajusta su postura elegante* Creo que necesito un momento para ordenar mis ideas. ¿Te parece si retomamos el hilo?"
        ];
        
        if (context.externalInfo) {
            const info = Array.isArray(context.externalInfo) ? context.externalInfo[0] : context.externalInfo;
            return {
                text: `*Sus orejas se erizan un momento* Encontré algo sobre "${info.title}", pero mis pensamientos están un poco dispersos. ¿Te parece si exploramos esto con más calma después?`,
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

// ==================== SISTEMA DE PERFIL DE USUARIO SIMPLIFICADO ====================

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
                profile_version INTEGER DEFAULT 1,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
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
            profile_version: 1,
            _cachedAt: Date.now()
        };

        await database.db.run(
            `INSERT INTO user_profiles (
                user_id, username, first_interaction, last_interaction,
                preferred_depth, preferred_style, preferred_language, interest_topics
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId, username, newProfile.first_interaction, newProfile.last_interaction,
                newProfile.preferred_depth, newProfile.preferred_style, newProfile.preferred_language,
                JSON.stringify([])
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
            this.updateInterestTopics(userId, interactionData.topics);
        }

        await this.updateProfile(userId, {
            total_interactions: profile.total_interactions,
            last_interaction: profile.last_interaction
        });
    }

    async updateInterestTopics(userId, newTopics) {
        const profile = await this.getProfile(userId);
        if (!profile) return;

        const currentTopics = profile.interest_topics || [];
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

        profile.interest_topics = updatedTopics;

        await this.updateProfile(userId, {
            interest_topics: updatedTopics
        });
    }

    async getPersonalizedPrompt(userId) {
        const profile = await this.getProfile(userId);
        if (!profile) return '';

        let personalization = '';

        personalization += `\n## Preferencia de profundidad: ${profile.preferred_depth}`;
        
        const allInterests = (profile.interest_topics || []).slice(0, 5).map(t => t.topic);
        if (allInterests.length > 0) {
            personalization += `\n## Temas de interés frecuente: ${allInterests.join(', ')}`;
        }

        personalization += `\n\n## Estilo de respuesta preferido: ${profile.preferred_style}`;
        switch(profile.preferred_style) {
            case 'analytical':
                personalization += '\nPriorizar estructura lógica y datos precisos.';
                break;
            case 'socratic':
                personalization += '\nPriorizar preguntas que inviten a reflexión.';
                break;
            case 'concise':
                personalization += '\nPriorizar respuestas breves y directas.';
                break;
        }

        return personalization;
    }
}

const userProfileManager = new UserProfileManager();
const emotionalAnalyzer = new EmotionalAnalyzer();
const intentAnalyzer = new IntentAnalyzer();

// ==================== MANEJADOR PRINCIPAL ====================
class MessageHandler {
    static async handleReply(message) {
        const userId = message.author.id;
        const userTag = `${message.author.username}#${message.author.discriminator}`;
        const startTime = Date.now();
        
        if (!rateLimiter.consumeToken(userId)) {
            const waitTime = rateLimiter.getUserWaitTime(userId);
            logger.warn('Rate limit excedido', { user: userTag, waitTime });
            
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
                contentPreview: message.content.substring(0, 50)
            });
            
            await message.channel.sendTyping();
            
            const userMessage = TextUtils.normalizeText(message.content);
            
            if (!userMessage || userMessage.trim().length < 1) {
                await message.reply({
                    content: "Por favor envía un mensaje con contenido.",
                    allowedMentions: { repliedUser: false }
                });
                return;
            }
            
            const emotionalState = emotionalAnalyzer.analyze(userMessage);
            const intent = intentAnalyzer.analyze(userMessage, emotionalState);
            const analysis = QueryAnalyzer.analyze(userMessage);
            
            let councilAnalysis = null;
            if (analysis.isPhilosophical) {
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
            }
            
            let externalInfo = null;
            if (analysis.needsExternalInfo && analysis.searchTerm) {
                externalInfo = await ExternalAPIs.searchAllSources(analysis.searchTerm);
            }
            
            let personalizedInfo = '';
            if (userProfileManager.initialized) {
                personalizedInfo = await userProfileManager.getPersonalizedPrompt(userId);
            }
            
            if (userProfileManager.initialized) {
                await userProfileManager.recordInteraction(userId, {
                    topics: analysis.isPhilosophical ? ['filosofía'] : analysis.types,
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
                    personalizedInfo: personalizedInfo,
                    emotionalState: emotionalState,
                    intent: intent
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
                hasExternalInfo: !!externalInfo
            });
            
        } catch (error) {
            logger.error('❌ Error procesando mensaje', {
                user: userTag,
                error: error.message
            });
            
            conversationManager.clearConversation(userId);
            
            try {
                await message.reply({
                    content: "🐱 *Mancy parpadea confundida*\nDisculpa, algo salió mal. ¿Podrías intentar de nuevo?",
                    allowedMentions: { repliedUser: false }
                });
            } catch (replyError) {
                logger.error('Error enviando mensaje de error', replyError.message);
            }
            
        } finally {
            rateLimiter.releaseToken();
        }
    }

    static async handleMention(message) {
        const content = message.content.toLowerCase();
        const userId = message.author.id;
        const userTag = `${message.author.username}#${message.author.discriminator}`;
        
        logger.info('Mención recibida', { user: userTag, content });
        
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
                    { name: 'Temas de interés', value: (profile.interest_topics || []).slice(0, 5).map(t => t.topic).join(', ') || 'Ninguno', inline: false }
                )
                .setFooter({ text: 'Usa !config para ajustar preferencias' });
            
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
            return;
        }
        
        if (/config|preferencias|ajustes/i.test(content)) {
            const depthMatch = content.match(/profundidad\s*(básica|basica|media|profunda)/i);
            const styleMatch = content.match(/estilo\s*(analítico|analitico|socrático|socratico|conciso)/i);
            
            const updates = {};
            
            if (depthMatch) {
                const depthMap = { 'básica': 'basic', 'basica': 'basic', 'media': 'medium', 'profunda': 'deep' };
                updates.preferred_depth = depthMap[depthMatch[1].toLowerCase()];
            }
            
            if (styleMatch) {
                const styleMap = { 
                    'analítico': 'analytical', 'analitico': 'analytical',
                    'socrático': 'socratic', 'socratico': 'socratic',
                    'conciso': 'concise'
                };
                updates.preferred_style = styleMap[styleMatch[1].toLowerCase()];
            }
            
            if (Object.keys(updates).length > 0) {
                await userProfileManager.updateProfile(userId, updates);
                await message.reply({ content: '✅ Preferencias actualizadas', allowedMentions: { repliedUser: false } });
            } else {
                await message.reply({ 
                    content: 'Uso: !config profundidad [básica|media|profunda] o !config estilo [analítico|socrático|conciso]',
                    allowedMentions: { repliedUser: false }
                });
            }
            return;
        }
        
        if (/concilio|modules|council|philosophy|filosof/i.test(content)) {
            const councilStatus = moduleCouncil.getCouncilStatus();
            
            const embed = new EmbedBuilder()
                .setColor(Colors.Purple)
                .setTitle('🏛️ Concilio Filosófico de Mancy')
                .setDescription('Sistema de análisis filosófico integrado')
                .addFields(
                    { name: 'Módulos Activos', value: councilStatus.activeModules.join('\n') || 'Ninguno', inline: true },
                    { name: 'Total Reuniones', value: councilStatus.totalMeetings.toString(), inline: true }
                );
            
            if (councilStatus.moduleStats?.philosophy) {
                const phil = councilStatus.moduleStats.philosophy;
                embed.addFields({
                    name: '📚 Filosofía',
                    value: `Análisis: ${phil.totalAnalyses}\nDilemas éticos: ${phil.ethicalDilemmasCount}\nRamas comunes: ${phil.mostCommonBranches?.map(b => b.branch).join(', ') || 'Ninguna'}`,
                    inline: false
                });
            }
            
            embed.setFooter({ text: `Versión ${CONFIG.BOT_VERSION} | Concilio v${councilStatus.version}` })
                .setTimestamp();
            
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
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
        
        if (/reset concilio|reiniciar modules|clear council/i.test(content)) {
            const resetResult = moduleCouncil.resetCouncil();
            
            await message.reply({
                content: `🔄 **Concilio Resetado**\n${resetResult.message}`,
                allowedMentions: { repliedUser: false }
            });
            return;
        }
        
        if (/borrar mis datos|delete my data/i.test(content)) {
            await database.db.run('DELETE FROM user_profiles WHERE user_id = ?', [userId]);
            await database.db.run('DELETE FROM conversations WHERE user_id = ?', [userId]);
            
            userProfileManager.profiles.delete(userId);
            conversationManager.clearConversation(userId);
            
            await message.reply({ 
                content: '✅ Todos tus datos han sido eliminados.',
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
                        userBuckets: rateLimiter.userBuckets.size
                    },
                    cache: responseCache.getStats(),
                    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
                    conversations: conversationManager.conversations.size,
                    yourConversation: conversationManager.getConversation(userId).length,
                    council: {
                        activeModules: Array.from(councilStatus.activeModules),
                        totalMeetings: councilStatus.totalMeetings
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
        
        if (/fix|reparar|resetear/i.test(content)) {
            conversationManager.clearConversation(userId);
            
            for (const [key] of responseCache.memoryCache.entries()) {
                if (key.includes(userId)) {
                    responseCache.delete(key);
                }
            }
            
            await message.reply({
                content: '🔧 Estado de conversación resetado.',
                allowedMentions: { repliedUser: false }
            });
            
            await message.channel.sendTyping();
            await sleep(1000);
            
            await message.reply({
                content: `Hola ${message.author.username}. He reiniciado mi estado. ¿En qué puedo ayudarte?`,
                allowedMentions: { repliedUser: false }
            });
            
            await conversationManager.addMessage(userId, 'assistant', 'Hola. He reiniciado mi estado. ¿En qué puedo ayudarte?');
            
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
                .setDescription('Chica Gato Seria con conocimiento filosófico')
                .addFields(
                    { name: '¿Cómo usar?', value: '1. Mencioname (@Mancy)\n2. Responde (haz reply) a mis mensajes para conversar\n3. ¡Listo!' },
                    { name: '¿Qué puedo hacer?', value: '• Responder preguntas generales\n• Buscar información en Wikipedia\n• Buscar libros y autores\n• Reflexión filosófica\n• Análisis de dilemas éticos' },
                    { name: 'Comandos del Concilio', value: '`@Mancy concilio` - Estado del sistema\n`@Mancy activar filosofía` - Activar módulo\n`@Mancy desactivar filosofía` - Desactivar módulo\n`@Mancy reset concilio` - Reiniciar sistema' },
                    { name: 'Comandos de perfil', value: '`@Mancy perfil` - Ver tu perfil\n`@Mancy config profundidad [básica|media|profunda]` - Configurar profundidad\n`@Mancy config estilo [analítico|socrático|conciso]` - Configurar estilo\n`@Mancy borrar mis datos` - Eliminar tus datos' },
                    { name: 'Comandos generales', value: '`@Mancy help` - Esta ayuda\n`@Mancy reset` - Reiniciar conversación\n`@Mancy stats` - Ver estadísticas\n`@Mancy diag` - Diagnóstico del sistema\n`@Mancy fix` - Reparar estado' }
                )
                .setFooter({ text: 'Solo respondo a replies' })
                .setTimestamp();
            
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
            return;
        }
        
        if (/reset|reiniciar|clear/i.test(content) && !content.includes('datos')) {
            conversationManager.clearConversation(userId);
            await message.reply({
                content: '✅ Historial de conversación reiniciado.',
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
                        { name: 'Tus temas de interés', value: (profile?.interest_topics || []).slice(0, 3).map(t => t.topic).join(', ') || 'Ninguno', inline: false }
                    );
                
                if (councilStatus) {
                    embed.addFields(
                        { name: 'Reuniones Concilio', value: councilStatus.totalMeetings.toString(), inline: true },
                        { name: 'Análisis filosóficos', value: `${councilStatus.moduleStats?.philosophy?.totalAnalyses || 0}`, inline: true }
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
        
        const introMessage = `Hola ${message.author.username}. Soy ${CONFIG.BOT_NAME}, una chica gato seria con conocimiento filosófico. **Responde a este mensaje** (haz reply) para conversar conmigo.`;
        
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
        await userProfileManager.initialize();
        await testGroqConnection();
        
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
            philosophyModule: CONFIG.PHILOSOPHY_MODULE_ENABLED ? '✅ Activado' : '❌ Desactivado',
            readyAt: new Date().toISOString()
        });
        
        client.user.setPresence({
            activities: [{
                name: 'responde a replies',
                type: ActivityType.Listening
            }],
            status: 'online'
        });
        
        await preCacheCommonTerms();
        
        logger.info('✅ Inicialización completada');
        
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
                await MessageHandler.handleReply(message);
                return;
            }
        }
        
        if (message.mentions.has(client.user) && !message.mentions.everyone) {
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
            conversations: conversationManager.conversations.size
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
        
        const councilStatus = moduleCouncil.getCouncilStatus();
        if (councilStatus.totalMeetings > 0) {
            logger.metric('council_meetings', councilStatus.totalMeetings);
        }
        
    }, CONFIG.HEALTH_CHECK_INTERVAL_MS);
}

// ==================== PRE-CACHE ====================
async function preCacheCommonTerms() {
    const commonTerms = [
        'ciencia', 'historia', 'literatura', 'matemáticas', 'física',
        'química', 'biología', 'filosofía', 'arte', 'música',
        'Miguel de Cervantes', 'Gabriel García Márquez', 'William Shakespeare',
        'ética', 'moral', 'existencialismo', 'conocimiento', 'verdad',
        'Platón', 'Aristóteles', 'Kant', 'Nietzsche', 'Descartes'
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
        philosophyModule: CONFIG.PHILOSOPHY_MODULE_ENABLED
    });
    
    try {
        setupPeriodicTasks();
        await client.login(process.env.DISCORD_TOKEN);
        logger.info('✅ Inicialización completada');
    } catch (error) {
        logger.error('❌ Error durante la inicialización', error);
        process.exit(1);
    }
}

// ==================== INICIAR LA APLICACIÓN ====================
initialize();
