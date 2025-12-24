import { Client, GatewayIntentBits } from 'discord.js';
import Groq from "groq-sdk";
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

// Verificar que las variables existen
if (!process.env.GROQ_API_KEY || !process.env.DISCORD_TOKEN) {
    console.error('❌ ERROR: Variables de entorno faltantes');
    process.exit(1);
}

// Inicializar clientes
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const groq = new Groq({ 
    apiKey: process.env.GROQ_API_KEY, 
    timeout: 15000 
});

// Configuración
const conversationHistory = new Map();

const MANCY_CONFIG = {
    name: 'Mancy',
    systemPrompt: `Eres Mancy, una chica gato seria y reservada.

REGLAS:
1. SOLO respondes cuando alguien hace REPLY a tu mensaje
2. NUNCA inicias conversaciones
3. Tono formal pero amable, sin lenguaje informal
4. Si no tienes nada relevante que decir, responde de manera cortés
5. Puedes consultar Wikipedia si el usuario pregunta sobre temas factuales
6. Para consultas sobre libros, autores o información literaria, usa OpenLibrary
7. Cuando uses información externa, menciona brevemente la fuente al final
8. Sé concisa en tus respuestas, máximo 2-3 frases cuando incluyas información externa
9. Responde en español a menos que el usuario especifique otro idioma
10. Nunca respondas con frases sin sentido o caracteres corruptos`,
    
    model: 'llama-3.1-8b-instant',
    temperature: 0.7, // Aumentado para respuestas más naturales
    maxTokens: 250,
    maxHistory: 4
};

// Cache para búsquedas
const searchCache = new Map();
const CACHE_DURATION = 300000;

// Función para normalizar texto y corregir caracteres corruptos
function normalizeText(text) {
    if (!text) return '';
    
    // Convertir a string si no lo es
    text = String(text);
    
    // Reemplazar caracteres corruptos comunes
    const corruptionMap = {
        'n': 'n', // Mantener 'n' normal
        'ecir': 'decir',
        'tengo': 'tengo',
        'que': 'que',
        't': 't',
        'd': 'd',
        'ñ': 'ñ',
        'á': 'á',
        'é': 'é',
        'í': 'í',
        'ó': 'ó',
        'ú': 'ú',
        'ü': 'ü',
        '¿': '¿',
        '¡': '¡'
    };
    
    // Limpiar caracteres de control y no imprimibles
    text = text.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
    
    // Eliminar múltiples espacios
    text = text.replace(/\s+/g, ' ');
    
    return text.trim();
}

// Función para limpiar respuesta del modelo
function cleanModelResponse(response) {
    if (!response) return 'Lo siento, no tengo una respuesta en este momento.';
    
    response = normalizeText(response);
    
    // Eliminar frases sin sentido o corruptas
    const nonsensePatterns = [
        /n\s+tengo\s+n\s+que\s+ecir/gi,
        /[a-z]\s+[a-z]\s+[a-z]\s+[a-z]/gi, // Patrones de letras sueltas
        /^[^a-zA-ZáéíóúñÁÉÍÓÚÑ¿¡]*$/, // Solo caracteres no alfabéticos
        /\b[a-z]\b\s+\b[a-z]\b\s+\b[a-z]\b/gi // Palabras de una letra repetidas
    ];
    
    for (const pattern of nonsensePatterns) {
        if (pattern.test(response)) {
            console.log('⚠️ Detectada respuesta corrupta, usando respuesta por defecto');
            return 'Entiendo. Si tienes alguna pregunta específica, estaré aquí para responder cuando me hagas reply.';
        }
    }
    
    // Eliminar lenguaje demasiado informal
    response = response.replace(/[jsjs|jaja|xd|lol|w+w+|haha|hehe]/gi, '');
    
    // Asegurar que empiece con mayúscula
    if (response.length > 0) {
        const firstChar = response.charAt(0);
        if (firstChar.match(/[a-záéíóúñ]/)) {
            response = firstChar.toUpperCase() + response.slice(1);
        }
    }
    
    // Asegurar puntuación final
    if (!/[.!?¡¿]$/.test(response)) {
        response += '.';
    }
    
    // Verificar que la respuesta tenga sentido mínimo
    const wordCount = response.split(/\s+/).length;
    if (wordCount < 2) {
        return 'Entiendo. Si necesitas algo más, puedes preguntarme.';
    }
    
    // Verificar caracteres válidos
    const validChars = response.match(/[a-zA-ZáéíóúñÁÉÍÓÚÑ¿¡\d\s.,;:!?\-"'()]/g);
    if (!validChars || validChars.length < response.length * 0.7) {
        console.log('⚠️ Muchos caracteres inválidos en respuesta');
        return 'Parece que hubo un error procesando la respuesta. Por favor, intenta de nuevo.';
    }
    
    return response;
}

// Función para buscar en Wikipedia
async function searchWikipedia(query) {
    const cacheKey = `wikipedia:${query.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        return cached.data;
    }
    
    try {
        const encodedQuery = encodeURIComponent(query);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodedQuery}`, {
            headers: { 
                'User-Agent': 'MancyBot/1.0',
                'Accept': 'application/json',
                'Accept-Charset': 'utf-8'
            },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            return null;
        }
        
        const data = await response.json();
        
        let info = '';
        if (data.title) info += `**${normalizeText(data.title)}**\n\n`;
        if (data.extract) {
            const extract = normalizeText(data.extract);
            info += extract.substring(0, 350);
            if (extract.length > 350) info += '...';
        }
        
        const result = info || null;
        searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
        
    } catch (error) {
        console.log('Error Wikipedia:', error.message);
        return null;
    }
}

// Función para buscar en OpenLibrary
async function searchOpenLibrary(query, searchType = 'title') {
    const cacheKey = `openlibrary:${searchType}:${query.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        return cached.data;
    }
    
    try {
        let url;
        
        if (searchType === 'author') {
            url = `https://openlibrary.org/search/authors.json?q=${encodeURIComponent(query)}&limit=2`;
        } else {
            url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=2&fields=title,author_name,first_publish_year,subject`;
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(url, {
            headers: { 
                'User-Agent': 'MancyBot/1.0',
                'Accept': 'application/json'
            },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
            return null;
        }
        
        const data = await response.json();
        
        if (!data.docs || data.docs.length === 0) {
            return null;
        }
        
        let info = '';
        const item = data.docs[0];
        
        if (searchType === 'author') {
            info += `**Autor:** ${normalizeText(item.name || 'Desconocido')}\n`;
            if (item.top_work) info += `**Obra destacada:** ${normalizeText(item.top_work)}\n`;
            if (item.birth_date) info += `**Nacimiento:** ${item.birth_date}\n`;
        } else {
            info += `**Título:** ${normalizeText(item.title || 'Desconocido')}\n`;
            if (item.author_name?.length > 0) {
                info += `**Autor(es):** ${item.author_name.map(normalizeText).join(', ')}\n`;
            }
            if (item.first_publish_year) {
                info += `**Año:** ${item.first_publish_year}\n`;
            }
        }
        
        const result = info || null;
        searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
        
    } catch (error) {
        console.log('Error OpenLibrary:', error.message);
        return null;
    }
}

// Detectar tipo de búsqueda
function detectSearchType(message) {
    const msg = normalizeText(message).toLowerCase();
    
    if (/(libro|novela|obra|lectura|resumen|sinopsis)/i.test(msg)) {
        return 'book';
    }
    
    if (/(autor|escritor|poeta|novelista)/i.test(msg)) {
        return 'author';
    }
    
    return 'general';
}

// Extraer término de búsqueda
function extractSearchTerm(message) {
    let term = normalizeText(message);
    
    // Eliminar palabras comunes
    const stopWords = [
        'qué', 'es', 'quién', 'dime', 'sobre', 'información',
        'historia', 'de', 'la', 'el', 'los', 'las', 'un', 'una',
        'libro', 'autor', 'novela', 'por', 'favor', 'puedes',
        'decir', 'hablar', 'acerca'
    ];
    
    stopWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        term = term.replace(regex, '');
    });
    
    term = term.trim();
    
    // Si queda muy corto, usar el mensaje original (limitado)
    if (term.length < 3) {
        term = message.substring(0, 50).trim();
    }
    
    return term;
}

// Cuando Mancy está lista
client.once('ready', () => {
    console.log(`✅ ${MANCY_CONFIG.name} conectada como ${client.user.tag}`);
    console.log(`🤖 Modelo: ${MANCY_CONFIG.model}`);
    console.log(`⚡ Temperatura: ${MANCY_CONFIG.temperature}`);
    client.user.setActivity('Reply only');
});

// Procesar REPLIES a Mancy
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    if (!message.reference) return;
    
    try {
        const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
        if (repliedMessage.author.id !== client.user.id) return;
        
        console.log(`📩 Reply de ${message.author.tag}:`, message.content.substring(0, 100));
        
        message.channel.sendTyping();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await handleMancyResponse(message);
        
    } catch (error) {
        console.log('Error procesando reply:', error.message);
    }
});

async function handleMancyResponse(message) {
    const userId = message.author.id;
    const userMessage = normalizeText(message.content);
    
    if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, [{ 
            role: 'system', 
            content: MANCY_CONFIG.systemPrompt 
        }]);
    }
    
    const history = conversationHistory.get(userId);
    
    try {
        // Agregar mensaje del usuario (normalizado)
        history.push({ 
            role: 'user', 
            content: userMessage || "Hola" 
        });
        
        // Limitar historial
        if (history.length > (1 + MANCY_CONFIG.maxHistory * 2)) {
            history.splice(1, history.length - (1 + MANCY_CONFIG.maxHistory * 2));
        }
        
        // Detectar si necesita búsqueda externa
        let externalInfo = null;
        let source = '';
        
        const hasQuestionWord = /(qu[ée]|qui[ée]n|c[óo]mo|d[óo]nde|cu[áa]ndo|por qu[ée])/i.test(userMessage);
        const isFactual = /(es|era|fue|son|eran)/i.test(userMessage);
        
        if ((hasQuestionWord && isFactual) || /(información|dime|sabes|conoce)/i.test(userMessage)) {
            const searchType = detectSearchType(userMessage);
            const searchTerm = extractSearchTerm(userMessage);
            
            if (searchTerm && searchTerm.length > 2) {
                if (searchType === 'book' || searchType === 'author') {
                    externalInfo = await searchOpenLibrary(searchTerm, searchType);
                    source = 'OpenLibrary';
                    
                    if (!externalInfo && searchType === 'author') {
                        externalInfo = await searchWikipedia(searchTerm);
                        source = 'Wikipedia';
                    }
                } else {
                    externalInfo = await searchWikipedia(searchTerm);
                    source = 'Wikipedia';
                }
            }
        }
        
        // Preparar mensaje para el modelo
        let finalMessage = userMessage;
        if (externalInfo) {
            finalMessage = `${userMessage}\n\n[Información de ${source}:]\n${externalInfo}`;
            history[history.length - 1].content = finalMessage;
        }
        
        // Obtener respuesta del modelo con configuración mejorada
        const completion = await groq.chat.completions.create({
            messages: history,
            model: MANCY_CONFIG.model,
            temperature: MANCY_CONFIG.temperature,
            max_tokens: MANCY_CONFIG.maxTokens,
            top_p: 0.9,
            frequency_penalty: 0.1, // Penalizar repeticiones
            presence_penalty: 0.1,  // Penalizar temas repetidos
            stream: false
        });
        
        let rawResponse = completion.choices?.[0]?.message?.content || '';
        
        // Limpiar y validar la respuesta
        let response = cleanModelResponse(rawResponse);
        
        // Si la respuesta está corrupta o es muy corta, usar respuesta por defecto
        if (response.includes('n teng n que ecir') || 
            response.length < 5 || 
            response.split(' ').length < 3) {
            
            console.log('🔄 Usando respuesta por defecto por respuesta corrupta');
            response = 'Entiendo. Si tienes alguna pregunta o necesitas información sobre algún tema, estaré aquí para ayudarte cuando me hagas reply.';
        }
        
        console.log(`🐱 Mancy:`, response.substring(0, 100));
        
        // Agregar al historial (la respuesta limpia)
        history.push({ 
            role: 'assistant', 
            content: response 
        });
        
        // Responder
        await message.reply({
            content: response,
            allowedMentions: { repliedUser: false }
        });
        
    } catch (error) {
        console.error('Error en handleMancyResponse:', error.message);
        
        // Respuestas de error específicas
        let errorResponse = 'Lo siento, hubo un error procesando tu mensaje.';
        
        if (error.message.includes('rate_limit')) {
            errorResponse = '⏳ Estoy recibiendo muchas solicitudes. Por favor, espera un momento.';
        } else if (error.message.includes('timeout')) {
            errorResponse = '⏰ La solicitud tardó demasiado. Intenta con una consulta más corta.';
        } else if (error.message.includes('context_length')) {
            conversationHistory.delete(userId);
            errorResponse = '🧹 He reiniciado nuestra conversación debido a un error. ¿En qué puedo ayudarte?';
        }
        
        await message.reply({
            content: errorResponse,
            allowedMentions: { repliedUser: false }
        });
    }
}

// Manejar mención inicial
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    const isMentioned = message.mentions.has(client.user) && !message.mentions.everyone;
    const isReply = message.reference;
    
    if (isMentioned && !isReply) {
        console.log(`📍 Mención inicial de ${message.author.tag}`);
        
        const userId = message.author.id;
        let userMessage = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
        userMessage = normalizeText(userMessage) || 'Hola';
        
        conversationHistory.set(userId, [
            { role: 'system', content: MANCY_CONFIG.systemPrompt },
            { role: 'user', content: userMessage }
        ]);
        
        try {
            const completion = await groq.chat.completions.create({
                messages: conversationHistory.get(userId),
                model: MANCY_CONFIG.model,
                temperature: 0.8, // Más creativo para saludos
                max_tokens: 150,
                top_p: 0.9,
                stream: false
            });
            
            let response = completion.choices?.[0]?.message?.content || '';
            response = cleanModelResponse(response);
            
            // Validar respuesta de saludo
            if (response.includes('n teng n que ecir') || response.length < 10) {
                response = 'Hola. Por favor, responde a este mensaje si quieres conversar o preguntarme algo.';
            }
            
            conversationHistory.get(userId).push({ role: 'assistant', content: response });
            
            await message.reply({
                content: response,
                allowedMentions: { repliedUser: false }
            });
            
        } catch (error) {
            console.error('Error en mención inicial:', error.message);
            await message.reply({
                content: 'Hola. Responde a este mensaje para comenzar una conversación.',
                allowedMentions: { repliedUser: false }
            });
        }
    }
});

// Comando reset
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    const isMentioned = message.mentions.has(client.user) && !message.mentions.everyone;
    if (isMentioned && message.content.toLowerCase().includes('reset')) {
        conversationHistory.delete(message.author.id);
        await message.reply({
            content: '✅ Historial reiniciado. Puedes comenzar una nueva conversación.',
            allowedMentions: { repliedUser: false }
        });
    }
});

// Comando help
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    const isMentioned = message.mentions.has(client.user) && !message.mentions.everyone;
    if (isMentioned && message.content.toLowerCase().includes('help')) {
        const helpMessage = `**📚 ${MANCY_CONFIG.name} - Ayuda**

Soy una chica gato seria que solo responde a replies.

**¿Cómo funciona?**
1. Mencioname primero (@${client.user.username})
2. Luego responde (reply) a mis mensajes para conversar

**Puedo ayudarte con:**
• Preguntas generales
• Información de Wikipedia
• Libros y autores (OpenLibrary)

**Comandos:**
• \`@${client.user.username} reset\` - Reinicia conversación
• \`@${client.user.username} help\` - Muestra esta ayuda

**Ejemplo:**
1. @${client.user.username} Hola
2. (Reply) ¿Quién escribió Don Quijote?`;

        await message.reply({
            content: helpMessage,
            allowedMentions: { repliedUser: false }
        });
    }
});

// Limpieza periódica
setInterval(() => {
    const now = Date.now();
    
    // Limpiar caché expirado
    for (const [key, value] of searchCache.entries()) {
        if (now - value.timestamp > CACHE_DURATION) {
            searchCache.delete(key);
        }
    }
    
    // Limpiar historiales muy antiguos (1 hora)
    // Nota: En producción necesitarías timestamp por usuario
    if (conversationHistory.size > 1000) {
        const entries = Array.from(conversationHistory.entries());
        for (let i = 0; i < 100; i++) {
            if (entries[i]) {
                conversationHistory.delete(entries[i][0]);
            }
        }
    }
}, 300000);

// Manejo de errores
client.on('error', console.error);
process.on('unhandledRejection', console.error);

// Iniciar bot
console.log('🚀 Iniciando Mancy con corrección de caracteres...');
console.log('🔧 Sistema de normalización de texto: ACTIVADO');

client.login(process.env.DISCORD_TOKEN);