import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import Groq from "groq-sdk";
import dotenv from 'dotenv';
import fetch from 'node-fetch';

// Cargar variables de entorno
dotenv.config();

// Verificar que las variables existen
if (!process.env.GROQ_API_KEY || !process.env.DISCORD_TOKEN) {
    console.error('❌ ERROR: Variables de entorno faltantes');
    console.error('Asegúrate de configurar GROQ_API_KEY y DISCORD_TOKEN en Render');
    process.exit(1);
}

// Inicializar clientes
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
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
    timeout: 45000, // 45 segundos máximo
    maxRetries: 2 // Reintentos automáticos
});

// Configuración
const conversationHistory = new Map();
const userCooldowns = new Map();
const COOLDOWN_TIME = 2000; // 2 segundos entre respuestas por usuario

const MANCY_CONFIG = {
    name: 'Mancy',
    systemPrompt: `Eres Mancy, una chica gato seria, reservada y educada. Tienes conocimiento enciclopédico y literario.

REGLAS ABSOLUTAS:
1. SOLO respondes cuando alguien hace REPLY a tu mensaje anterior
2. NUNCA inicies conversaciones por tu cuenta
3. Mantén un tono formal pero accesible
4. Sé concisa pero informativa (2-4 frases normalmente)
5. Si no sabes algo, admítelo honestamente
6. Usa español neutro a menos que el usuario pida otro idioma
7. Cuando uses información externa, menciona la fuente brevemente al final
8. Nunca uses caracteres extraños, símbolos corruptos o texto roto
9. Evita lenguaje coloquial excesivo (XD, lol, jaja, etc.)
10. Si la pregunta es ambigua, pide clarificación amablemente
11. Nunca te repitas innecesariamente
12. Siempre verifica que tu respuesta tenga sentido completo

PERSONALIDAD:
- Seria pero no fría
- Reservada pero servicial
- Inteligente pero humilde
- Paciente y detallista
- Conocedora de literatura y ciencia

FORMATO DE RESPUESTA:
- Comienza con mayúscula
- Termina con puntuación adecuada
- Párrafos cortos y claros
- Sin emojis excesivos (máximo 1 si es pertinente)
- Sin abreviaturas de chat`,
    
    model: 'llama-3.1-70b-versatile',
    temperature: 0.25, // BAJÍSIMO para máxima coherencia
    maxTokens: 350, // Suficiente para respuestas completas
    maxHistory: 4, // Mantener contexto pero no sobrecargar
    fallbackModel: 'mixtral-8x7b-32768' // Modelo de respaldo
};

// Cache mejorado con TTL y límite de tamaño
class SmartCache {
    constructor(maxSize = 500, defaultTTL = 600000) { // 10 minutos por defecto
        this.cache = new Map();
        this.maxSize = maxSize;
        this.defaultTTL = defaultTTL;
    }

    set(key, value, ttl = this.defaultTTL) {
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        this.cache.set(key, {
            data: value,
            expiry: Date.now() + ttl
        });
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        
        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return null;
        }
        
        return item.data;
    }

    delete(key) {
        this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    cleanup() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now > value.expiry) {
                this.cache.delete(key);
            }
        }
    }
}

// Inicializar caches
const searchCache = new SmartCache(1000, 900000); // 15 minutos para búsquedas
const responseCache = new SmartCache(200, 300000); // 5 minutos para respuestas similares

// Sistema de logging mejorado
const logger = {
    info: (msg, data = '') => console.log(`[${new Date().toISOString()}] ℹ️ ${msg}`, data),
    warn: (msg, data = '') => console.warn(`[${new Date().toISOString()}] ⚠️ ${msg}`, data),
    error: (msg, data = '') => console.error(`[${new Date().toISOString()}] ❌ ${msg}`, data),
    debug: (msg, data = '') => {
        if (process.env.DEBUG === 'true') {
            console.debug(`[${new Date().toISOString()}] 🔍 ${msg}`, data);
        }
    }
};

// ==================== SISTEMA DE NORMALIZACIÓN MEJORADO ====================

function normalizeText(text) {
    if (!text) return '';
    
    // Convertir a string
    text = String(text);
    
    // Eliminar caracteres de control y no imprimibles
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
    
    // Corregir encoding UTF-8 mal interpretado (común en APIs)
    const encodingCorrections = {
        // UTF-8 mal decodificado como Latin-1
        'Ã¡': 'á', 'Ã©': 'é', 'Ã­': 'í', 'Ã³': 'ó', 'Ãº': 'ú', 'Ã±': 'ñ',
        'Ã': 'Á', 'Ã': 'É', 'Ã': 'Í', 'Ã': 'Ó', 'Ã': 'Ú', 'Ã': 'Ñ',
        'Ã€': 'À', 'Ãˆ': 'È', 'ÃŒ': 'Ì', 'Ã’': 'Ò', 'Ã™': 'Ù',
        'Ã¢': 'â', 'Ãª': 'ê', 'Ã®': 'î', 'Ã´': 'ô', 'Ã»': 'û',
        'Ã£': 'ã', 'Ãµ': 'õ', 'Ã¼': 'ü', 'Ã§': 'ç',
        'Â¿': '¿', 'Â¡': '¡', 'Â´': "'", 'Â°': '°', 'Âª': 'ª', 'Âº': 'º',
        'â€œ': '"', 'â€': '"', 'â€˜': "'", 'â€™': "'", 'â€¦': '...',
        'â€“': '–', 'â€”': '—',
        
        // Patrones corruptos específicos de LLMs
        'n tengo n que ecir': 'No tengo nada que decir',
        'n[o]?[\\s]*tengo[\\s]*n[\\s]*que[\\s]*ecir': 'No tengo nada que decir',
        '\\bn\\s+tengo\\s+n\\s+que\\s+ecir\\b': 'No tengo nada que decir',
    };
    
    Object.keys(encodingCorrections).forEach(pattern => {
        const regex = new RegExp(pattern, 'gi');
        text = text.replace(regex, encodingCorrections[pattern]);
    });
    
    // Eliminar caracteres Unicode problemáticos pero mantener emojis básicos
    text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069]/g, '');
    
    // Normalizar espacios
    text = text.replace(/\s+/g, ' ').trim();
    
    // Normalizar comillas y puntuación
    text = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    
    return text;
}

// ==================== SISTEMA DE VALIDACIÓN DE RESPUESTAS ====================

function validateResponse(response) {
    if (!response || typeof response !== 'string') {
        return { valid: false, reason: 'Respuesta vacía o no es texto' };
    }
    
    const normalized = normalizeText(response);
    
    // Longitud mínima
    if (normalized.length < 5) {
        return { valid: false, reason: 'Respuesta demasiado corta' };
    }
    
    // Patrones corruptos ABSOLUTOS
    const absoluteCorruptPatterns = [
        /^[^a-zA-ZáéíóúñÁÉÍÓÚÑ0-9\s¿¡.,!?;:"'()-]+$/, // Solo caracteres inválidos
        /(\b\w\b\s+){6,}/, // 6+ palabras de una letra
        /([a-zA-Z])\1{5,}/, // 6+ letras repetidas (aaaaaa)
        /�/, // Caracter de reemplazo Unicode
        /\b(n\s*){3,}\b/i, // Muchas 'n' sueltas
        /\b(tengo\s*){2,}\b/i, // 'tengo' repetido
    ];
    
    for (const pattern of absoluteCorruptPatterns) {
        if (pattern.test(normalized)) {
            return { valid: false, reason: 'Patrón corrupto detectado' };
        }
    }
    
    // Palabras válidas mínimas (palabras de 2+ letras)
    const validWords = normalized.split(/\s+/).filter(word => 
        word.length >= 2 && /[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(word)
    );
    
    if (validWords.length < 2) {
        return { valid: false, reason: 'No hay suficientes palabras válidas' };
    }
    
    // Verificar estructura básica
    const hasCapitalStart = /^[A-ZÁÉÍÓÚÑ¿¡]/.test(normalized);
    const hasProperEnding = /[.!?¡¿]$/.test(normalized);
    
    if (!hasCapitalStart || !hasProperEnding) {
        // Intentar corregir
        const corrected = normalized.charAt(0).toUpperCase() + normalized.slice(1);
        const finalCorrected = corrected + (hasProperEnding ? '' : '.');
        return { 
            valid: true, 
            corrected: finalCorrected,
            reason: 'Estructura corregida' 
        };
    }
    
    return { valid: true, corrected: normalized, reason: 'Respuesta válida' };
}

// ==================== APIS EXTERNAS MEJORADAS ====================

// API de Wikipedia con mejor manejo de errores
async function searchWikipedia(query, language = 'es') {
    const cacheKey = `wiki:${language}:${query.toLowerCase().trim()}`;
    const cached = searchCache.get(cacheKey);
    if (cached) {
        logger.debug('Cache hit Wikipedia', query);
        return cached;
    }
    
    try {
        const encodedQuery = encodeURIComponent(query);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        
        const url = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodedQuery}`;
        
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'MancyBot/1.0 (+https://github.com/)',
                'Accept': 'application/json',
                'Accept-Charset': 'utf-8',
                'Accept-Language': language
            }
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
            if (response.status === 404) {
                logger.debug('Wikipedia no encontró', query);
                searchCache.set(cacheKey, null, 300000); // Cache negativo 5 minutos
                return null;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.extract) {
            logger.debug('Wikipedia sin extracto', query);
            searchCache.set(cacheKey, null, 300000);
            return null;
        }
        
        // Formatear información de manera concisa
        const title = normalizeText(data.title || query);
        const extract = normalizeText(data.extract);
        
        // Acortar inteligentemente manteniendo oraciones completas
        let shortExtract = extract;
        if (extract.length > 300) {
            const sentences = extract.split(/[.!?]+/);
            let accumulated = '';
            for (const sentence of sentences) {
                const trimmed = sentence.trim();
                if (trimmed && (accumulated.length + trimmed.length) <= 300) {
                    accumulated += (accumulated ? ' ' : '') + trimmed + '.';
                } else {
                    break;
                }
            }
            shortExtract = accumulated || extract.substring(0, 297) + '...';
        }
        
        const result = {
            source: 'Wikipedia',
            title: title,
            content: shortExtract,
            url: data.content_urls?.desktop?.page || `https://${language}.wikipedia.org/wiki/${encodedQuery}`
        };
        
        searchCache.set(cacheKey, result);
        logger.info('Wikipedia éxito', query);
        return result;
        
    } catch (error) {
        logger.error('Error Wikipedia', { query, error: error.message });
        searchCache.set(cacheKey, null, 60000); // Cache negativo corto
        return null;
    }
}

// API de OpenLibrary mejorada
async function searchOpenLibrary(query, searchType = 'title', limit = 2) {
    const cacheKey = `ol:${searchType}:${query.toLowerCase().trim()}`;
    const cached = searchCache.get(cacheKey);
    if (cached) {
        logger.debug('Cache hit OpenLibrary', query);
        return cached;
    }
    
    try {
        let url;
        
        if (searchType === 'author') {
            url = `https://openlibrary.org/search/authors.json?q=${encodeURIComponent(query)}&limit=${limit}`;
        } else if (searchType === 'subject') {
            url = `https://openlibrary.org/subjects/${encodeURIComponent(query.toLowerCase().replace(/\s+/g, '_'))}.json`;
        } else {
            url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit}&fields=title,author_name,first_publish_year,subject,isbn,key`;
        }
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'MancyBot/1.0',
                'Accept': 'application/json',
                'Accept-Charset': 'utf-8'
            }
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.docs || data.docs.length === 0) {
            logger.debug('OpenLibrary sin resultados', { query, searchType });
            searchCache.set(cacheKey, null, 300000);
            return null;
        }
        
        const results = data.docs.slice(0, 2).map(doc => {
            const result = {
                source: 'OpenLibrary',
                type: searchType,
                title: normalizeText(doc.title || doc.name || 'Sin título'),
                url: `https://openlibrary.org${doc.key || '/search'}`
            };
            
            if (searchType === 'author') {
                if (doc.birth_date) result.birthDate = doc.birth_date;
                if (doc.death_date) result.deathDate = doc.death_date;
                if (doc.top_work) result.topWork = normalizeText(doc.top_work);
                if (doc.work_count) result.workCount = doc.work_count;
            } else {
                if (doc.author_name) {
                    result.authors = doc.author_name.map(normalizeText);
                }
                if (doc.first_publish_year) {
                    result.year = doc.first_publish_year;
                }
                if (doc.subject) {
                    result.subjects = doc.subject.slice(0, 3).map(normalizeText);
                }
                if (doc.isbn) {
                    result.isbn = doc.isbn[0];
                }
            }
            
            return result;
        });
        
        searchCache.set(cacheKey, results);
        logger.info('OpenLibrary éxito', { query, results: results.length });
        return results;
        
    } catch (error) {
        logger.error('Error OpenLibrary', { query, searchType, error: error.message });
        searchCache.set(cacheKey, null, 60000);
        return null;
    }
}

// ==================== DETECCIÓN DE INTENCIONES MEJORADA ====================

function analyzeQuery(message) {
    const normalized = normalizeText(message).toLowerCase();
    
    // Palabras clave para cada tipo de búsqueda
    const patterns = {
        wikipedia: [
            /(qué|quien|quién|como|cómo|donde|dónde|cuando|cuándo|por qué|porque)\s+es\s+/i,
            /(historia|información|definición|significado)\s+de\s+/i,
            /quién\s+(inventó|descubrió|creó|escribió)/i,
            /(fecha|año)\s+de\s+/i,
            /\b(wikipedia|enciclopedia|saber|conocer)\b/i
        ],
        books: [
            /(libro|novela|obra|lectura|autor|escritor|poeta|literatura)\b/i,
            /(leer|recomendar|sinopsis|resumen)\s+(de|sobre)\s+/i,
            /(publicó|escribió|publicado|editado)\s+/i,
            /\b(isbn|editorial|publicación)\b/i
        ],
        authors: [
            /(autor|escritor|poeta|novelista|dramaturgo)\s+(llamado|nombre|famoso)/i,
            /quién\s+escribió\s+/i,
            /(biografía|vida)\s+de\s+/i,
            /(nació|murio|murió|nacimiento|muerte)\s+/i
        ],
        factual: [
            /(capital|país|ciudad|continente|moneda|idioma)\s+de\s+/i,
            /(población|habitantes|área|superficie)\s+/i,
            /(temperatura|clima|geografía|montaña|río|lago)\s+/i,
            /(ciencia|tecnología|matemática|física|química|biología)\s+/i
        ]
    };
    
    const detectedTypes = [];
    
    for (const [type, typePatterns] of Object.entries(patterns)) {
        if (typePatterns.some(pattern => pattern.test(normalized))) {
            detectedTypes.push(type);
        }
    }
    
    // Extraer término de búsqueda
    let searchTerm = normalized;
    
    // Eliminar palabras comunes de pregunta
    const stopPhrases = [
        'qué es', 'quién es', 'cómo es', 'dónde está', 'cuándo fue',
        'por qué', 'dime sobre', 'información de', 'habla de', 'sabes de',
        'puedes decirme', 'podrías decir', 'me puedes', 'necesito saber'
    ];
    
    stopPhrases.forEach(phrase => {
        const regex = new RegExp(`^${phrase}\\s+`, 'i');
        searchTerm = searchTerm.replace(regex, '');
    });
    
    // Eliminar signos de puntuación extra
    searchTerm = searchTerm.replace(/[.,!?;:¿¡]/g, '').trim();
    
    // Si quedó muy corto, usar las primeras palabras significativas
    if (searchTerm.length < 3 || searchTerm.split(/\s+/).length < 2) {
        const words = normalized.split(/\s+/).filter(word => 
            word.length > 3 && !/^(qué|quien|como|donde|cuando|por|para|sobre|de|la|el|los|las|un|una|unos|unas)$/i.test(word)
        );
        searchTerm = words.slice(0, 4).join(' ') || normalized.substring(0, 50);
    }
    
    return {
        types: detectedTypes.length > 0 ? detectedTypes : ['general'],
        searchTerm: searchTerm.substring(0, 100),
        needsExternalInfo: detectedTypes.length > 0,
        original: message
    };
}

// ==================== GENERACIÓN DE RESPUESTAS CON FALLBACKS ====================

async function generateMancyResponse(history, userMessage, context = {}) {
    const MAX_ATTEMPTS = 3;
    const models = [MANCY_CONFIG.model, MANCY_CONFIG.fallbackModel];
    
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const currentModel = models[attempt % models.length];
        
        try {
            logger.info(`Generando respuesta`, { 
                attempt: attempt + 1, 
                model: currentModel,
                contextLength: history.length 
            });
            
            // Preparar mensajes con contexto de búsqueda si existe
            const messages = [...history];
            if (context.externalInfo) {
                const lastUserMsg = messages[messages.length - 1];
                const infoText = `Información encontrada:\n${JSON.stringify(context.externalInfo, null, 2)}`;
                messages[messages.length - 1] = {
                    ...lastUserMsg,
                    content: `${lastUserMsg.content}\n\n${infoText}`
                };
            }
            
            const completion = await groq.chat.completions.create({
                messages: messages,
                model: currentModel,
                temperature: MANCY_CONFIG.temperature + (attempt * 0.1), // Aumentar gradualmente
                max_tokens: MANCY_CONFIG.maxTokens,
                top_p: 0.85,
                frequency_penalty: 0.3,
                presence_penalty: 0.2,
                stream: false
            });
            
            const rawResponse = completion.choices?.[0]?.message?.content || '';
            logger.debug('Respuesta cruda', rawResponse.substring(0, 100));
            
            const validation = validateResponse(rawResponse);
            
            if (validation.valid) {
                logger.info('Respuesta válida generada', {
                    attempt: attempt + 1,
                    model: currentModel,
                    length: validation.corrected.length
                });
                return validation.corrected;
            } else {
                logger.warn('Respuesta inválida', {
                    attempt: attempt + 1,
                    reason: validation.reason,
                    model: currentModel
                });
                
                // En el último intento, usar respuesta de respaldo
                if (attempt === MAX_ATTEMPTS - 1) {
                    return generateFallbackResponse(userMessage, context);
                }
                
                // Agregar instrucción más específica para el siguiente intento
                const systemPrompt = MANCY_CONFIG.systemPrompt;
                messages[0] = {
                    role: 'system',
                    content: `${systemPrompt}\n\nIMPORTANTE: Responde de manera COMPLETA, COHERENTE y SIN CARACTERES CORRUPTOS. Usa español correcto.`
                };
            }
            
        } catch (error) {
            logger.error('Error generando respuesta', {
                attempt: attempt + 1,
                error: error.message,
                model: currentModel
            });
            
            if (attempt === MAX_ATTEMPTS - 1) {
                return generateFallbackResponse(userMessage, context);
            }
            
            // Esperar antes de reintentar
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
    
    return generateFallbackResponse(userMessage, context);
}

function generateFallbackResponse(userMessage, context) {
    logger.warn('Usando respuesta de respaldo');
    
    const fallbacks = [
        "Entiendo tu pregunta, pero estoy teniendo dificultades técnicas para procesarla completamente. ¿Podrías reformularla de manera más específica?",
        "Disculpa, en este momento no puedo acceder a toda la información necesaria para responder adecuadamente. ¿Hay algo más en lo que pueda ayudarte?",
        "Parece que hay un problema temporal con mis recursos de información. Te sugiero consultar directamente en Wikipedia u OpenLibrary para obtener datos precisos.",
        "Lamento los inconvenientes. Por favor, respóndeme de nuevo con tu pregunta y haré mi mejor esfuerzo por ayudarte.",
        "Como chica gato seria que soy, prefiero no dar información incompleta. ¿Podrías especificar mejor qué necesitas saber?"
    ];
    
    // Si tenemos información externa, intentar usarla
    if (context.externalInfo) {
        const info = context.externalInfo;
        if (Array.isArray(info) && info.length > 0) {
            const first = info[0];
            return `Según mis registros: ${first.title || 'Información encontrada'}. Para más detalles, te sugiero consultar la fuente directamente.`;
        } else if (info && info.title) {
            return `Encontré información sobre "${info.title}". Sin embargo, mis sistemas están limitados ahora. La fuente es ${info.source || 'una enciclopedia'}.`;
        }
    }
    
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

// ==================== MANEJO PRINCIPAL DE MENSAJES ====================

async function handleMancyResponse(message) {
    const userId = message.author.id;
    const userTag = `${message.author.username}#${message.author.discriminator}`;
    
    // Verificar cooldown
    const now = Date.now();
    const lastResponse = userCooldowns.get(userId);
    if (lastResponse && (now - lastResponse) < COOLDOWN_TIME) {
        logger.debug('Usuario en cooldown', userTag);
        return; // Silenciosamente ignorar
    }
    
    userCooldowns.set(userId, now);
    
    if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, [{ 
            role: 'system', 
            content: MANCY_CONFIG.systemPrompt 
        }]);
    }
    
    const history = conversationHistory.get(userId);
    const userMessage = normalizeText(message.content);
    
    logger.info('Procesando reply', { user: userTag, message: userMessage.substring(0, 50) });
    
    try {
        // Enviar indicador de escritura
        await message.channel.sendTyping();
        
        // Analizar la consulta
        const analysis = analyzeQuery(userMessage);
        logger.debug('Análisis de consulta', analysis);
        
        // Buscar información externa si es necesario
        let externalInfo = null;
        if (analysis.needsExternalInfo && analysis.searchTerm) {
            // Priorizar según tipo detectado
            if (analysis.types.includes('wikipedia') || analysis.types.includes('factual')) {
                externalInfo = await searchWikipedia(analysis.searchTerm);
            }
            
            if (!externalInfo && analysis.types.includes('books')) {
                externalInfo = await searchOpenLibrary(analysis.searchTerm, 'title');
            }
            
            if (!externalInfo && analysis.types.includes('authors')) {
                externalInfo = await searchOpenLibrary(analysis.searchTerm, 'author');
            }
            
            if (!externalInfo && analysis.searchTerm.length > 2) {
                // Último intento con Wikipedia
                externalInfo = await searchWikipedia(analysis.searchTerm);
            }
        }
        
        // Agregar mensaje del usuario al historial
        history.push({ 
            role: 'user', 
            content: userMessage || "Hola" 
        });
        
        // Limitar historial
        const maxMessages = 1 + (MANCY_CONFIG.maxHistory * 2);
        if (history.length > maxMessages) {
            history.splice(1, history.length - maxMessages);
        }
        
        // Generar respuesta
        const context = {
            externalInfo: externalInfo,
            queryAnalysis: analysis
        };
        
        const response = await generateMancyResponse(history, userMessage, context);
        
        // Agregar respuesta al historial
        history.push({ 
            role: 'assistant', 
            content: response 
        });
        
        // Cachear respuestas similares
        const responseHash = userMessage.toLowerCase().replace(/\s+/g, '_').substring(0, 50);
        responseCache.set(`resp:${responseHash}`, response, 300000);
        
        // Enviar respuesta
        await message.reply({
            content: response,
            allowedMentions: { repliedUser: false }
        });
        
        logger.info('Respuesta enviada', { 
            user: userTag, 
            length: response.length,
            hasExternalInfo: !!externalInfo 
        });
        
    } catch (error) {
        logger.error('Error en handleMancyResponse', {
            user: userTag,
            error: error.message,
            stack: error.stack?.substring(0, 200)
        });
        
        // Intentar respuesta de error
        try {
            await message.reply({
                content: "🐱 *Mancy parpadea confundida*\nDisculpa, algo salió mal con mis circuitos felinos. ¿Podrías intentar de nuevo?",
                allowedMentions: { repliedUser: false }
            });
        } catch (replyError) {
            logger.error('Error al enviar mensaje de error', replyError.message);
        }
        
        // Limpiar historial problemático
        conversationHistory.delete(userId);
        userCooldowns.delete(userId);
    }
}

// ==================== EVENTOS DE DISCORD ====================

client.once('ready', () => {
    logger.info(`${MANCY_CONFIG.name} conectada`, {
        tag: client.user.tag,
        id: client.user.id,
        guilds: client.guilds.cache.size,
        model: MANCY_CONFIG.model
    });
    
    client.user.setPresence({
        activities: [{
            name: 'solo responde a replies',
            type: ActivityType.Watching
        }],
        status: 'online'
    });
});

// Manejar REPLIES a Mancy
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.author.id === client.user.id) return;
    
    try {
        // Verificar si es reply a Mancy
        if (message.reference) {
            const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
            if (repliedMessage.author.id === client.user.id) {
                await handleMancyResponse(message);
                return;
            }
        }
        
        // Verificar mención directa
        if (message.mentions.has(client.user) && !message.mentions.everyone) {
            const isHelp = /help|ayuda|comandos/i.test(message.content);
            const isReset = /reset|reiniciar|clear/i.test(message.content);
            
            if (isHelp) {
                await message.reply({
                    content: `**🐱 ${MANCY_CONFIG.name} - Ayuda**\n\nSolo respondo a **replies** (respuestas) de mis mensajes.\n\n1. Mencioname primero (@${client.user.username})\n2. Luego haz **reply** a mi respuesta para conversar\n\nPuedo buscar información en **Wikipedia** y **OpenLibrary** sobre libros y autores.\n\n*Soy una chica gato seria y reservada.*`,
                    allowedMentions: { repliedUser: false }
                });
                return;
            }
            
            if (isReset) {
                conversationHistory.delete(message.author.id);
                await message.reply({
                    content: '✅ Historial de conversación reiniciado. Puedes comenzar de nuevo mencionándome.',
                    allowedMentions: { repliedUser: false }
                });
                return;
            }
            
            // Mención inicial - enviar mensaje introductorio
            const introMessage = "Hola. Soy Mancy, una chica gato seria. **Responde a este mensaje** (haz reply) para conversar conmigo o preguntarme algo.";
            const sentMessage = await message.reply({
                content: introMessage,
                allowedMentions: { repliedUser: false }
            });
            
            // Inicializar historial
            const userId = message.author.id;
            conversationHistory.set(userId, [
                { role: 'system', content: MANCY_CONFIG.systemPrompt },
                { role: 'assistant', content: introMessage }
            ]);
            
            logger.info('Mensaje inicial enviado', { user: `${message.author.username}#${message.author.discriminator}` });
        }
        
    } catch (error) {
        logger.error('Error en messageCreate', {
            error: error.message,
            messageId: message.id,
            channelId: message.channelId
        });
    }
});

// ==================== MANTENIMIENTO PERIÓDICO ====================

setInterval(() => {
    const now = Date.now();
    
    // Limpiar cooldowns viejos (10 minutos)
    for (const [userId, timestamp] of userCooldowns.entries()) {
        if (now - timestamp > 600000) {
            userCooldowns.delete(userId);
        }
    }
    
    // Limpiar historiales muy antiguos (1 hora sin uso)
    // Nota: En producción necesitarías tracking de última actividad
    if (conversationHistory.size > 1000) {
        const entries = Array.from(conversationHistory.entries());
        for (let i = 0; i < Math.min(100, entries.length); i++) {
            conversationHistory.delete(entries[i][0]);
        }
        logger.info('Limpieza de historiales', { removed: 100 });
    }
    
    // Limpiar caches
    searchCache.cleanup();
    responseCache.cleanup();
    
    // Log de estado
    logger.debug('Estado del sistema', {
        usersInMemory: conversationHistory.size,
        cooldowns: userCooldowns.size,
        searchCache: searchCache.cache.size,
        responseCache: responseCache.cache.size
    });
    
}, 300000); // Cada 5 minutos

// ==================== MANEJO DE ERRORES GLOBALES ====================

client.on('error', (error) => {
    logger.error('Error de Discord client', error);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', { reason: String(reason), promise });
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
    // No salir del proceso, intentar recuperar
    setTimeout(() => {
        logger.info('Reiniciando después de excepción no capturada');
    }, 5000);
});

// ==================== INICIAR BOT ====================

logger.info('Iniciando Mancy con sistemas mejorados...');
logger.info('Configuración', {
    model: MANCY_CONFIG.model,
    fallbackModel: MANCY_CONFIG.fallbackModel,
    temperature: MANCY_CONFIG.temperature,
    maxTokens: MANCY_CONFIG.maxTokens
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
    logger.error('Error al conectar a Discord', error);
    process.exit(1);
});
