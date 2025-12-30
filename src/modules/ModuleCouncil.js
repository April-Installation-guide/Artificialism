// src/modules/ModuleCouncil.js

class ModuleCouncil {
    constructor() {
        this.chambers = {
            psychology: null,
            philosophy: null,
            decision: null,
            knowledge: null
        };
        
        this.activeModules = new Set();
        this.councilLog = [];
        this.maxLogSize = 100;
    }

    /**
     * Inicializar todas las cámaras
     */
    async initializeCouncil() {
        try {
            // Cargar cámaras dinámicamente
            const PsychologyChamber = await import('./PsychologyChamber.js');
            const PhilosophyChamber = await import('./PhilosophyChamber.js');
            const DecisionChamber = await import('./DecisionChamber.js');
            const KnowledgeAssembly = await import('./KnowledgeAssembly.js');
            
            this.chambers.psychology = new PsychologyChamber.default();
            this.chambers.philosophy = new PhilosophyChamber.default();
            this.chambers.decision = new DecisionChamber.default();
            this.chambers.knowledge = new KnowledgeAssembly.default();
            
            this.activeModules.add('psychology');
            this.activeModules.add('philosophy');
            this.activeModules.add('decision');
            this.activeModules.add('knowledge');
            
            this.logCouncilAction('initialize', 'Concilio de Módulos inicializado exitosamente');
            
            return {
                success: true,
                chambers: Object.keys(this.chambers),
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            this.logCouncilAction('error', `Error inicializando concilio: ${error.message}`);
            throw error;
        }
    }

    /**
     * Convocar reunión de módulos para analizar pregunta
     */
    async conveneCouncilMeeting(userQuestion, context = {}) {
        const meetingId = `meeting_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const meetingStart = Date.now();
        
        this.logCouncilAction('meeting_start', {
            meetingId,
            question: userQuestion.substring(0, 100),
            participantCount: this.activeModules.size
        });
        
        // ===== PRIMERA RONDA: Análisis Individual =====
        const individualAnalyses = {};
        
        // Psicología analiza
        if (this.chambers.psychology && this.activeModules.has('psychology')) {
            individualAnalyses.psychology = await this.chambers.psychology.analyzeQuestion(
                userQuestion,
                context
            );
        }
        
        // Filosofía analiza
        if (this.chambers.philosophy && this.activeModules.has('philosophy')) {
            individualAnalyses.philosophy = await this.chambers.philosophy.analyzeQuestion(
                userQuestion,
                context
            );
        }
        
        // ===== SEGUNDA RONDA: Integración de Conocimiento =====
        let integratedKnowledge = null;
        if (this.chambers.knowledge && this.activeModules.has('knowledge')) {
            integratedKnowledge = await this.chambers.knowledge.integrateAnalyses(
                individualAnalyses,
                userQuestion,
                context
            );
        }
        
        // ===== TERCERA RONDA: Toma de Decisiones =====
        let councilDecision = null;
        if (this.chambers.decision && this.activeModules.has('decision')) {
            councilDecision = await this.chambers.decision.makeCouncilDecision(
                userQuestion,
                individualAnalyses,
                integratedKnowledge,
                context
            );
        }
        
        // ===== RESULTADO FINAL DEL CONCILIO =====
        const meetingResult = {
            meetingId,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - meetingStart,
            participants: Array.from(this.activeModules),
            
            // Análisis individuales
            analyses: individualAnalyses,
            
            // Conocimiento integrado
            integratedKnowledge,
            
            // Decisión final
            decision: councilDecision,
            
            // Recomendaciones del concilio
            councilRecommendations: this.generateCouncilRecommendations(
                individualAnalyses,
                integratedKnowledge,
                councilDecision
            ),
            
            // Prioridades establecidas
            priorities: this.establishCouncilPriorities(
                individualAnalyses,
                councilDecision
            )
        };
        
        this.logCouncilAction('meeting_end', {
            meetingId,
            processingTime: meetingResult.processingTime,
            decision: councilDecision?.action || 'no_decision',
            recommendationsCount: meetingResult.councilRecommendations.length
        });
        
        // Guardar en registro del concilio
        this.addToCouncilLog(meetingResult);
        
        return meetingResult;
    }

    /**
     * Generar recomendaciones del concilio
     */
    generateCouncilRecommendations(analyses, knowledge, decision) {
        const recommendations = [];
        
        // Recomendación basada en psicología
        if (analyses.psychology?.needsProfessionalHelp) {
            recommendations.push({
                type: 'safety',
                priority: 'high',
                message: '⚠️ **Recomendación del Concilio**: Esta consulta sugiere necesidad de apoyo profesional. Considera contactar con un psicólogo.',
                source: 'PsychologyChamber',
                action: 'suggest_professional_help'
            });
        }
        
        // Recomendación basada en filosofía
        if (analyses.philosophy?.isEthicalDilemma) {
            recommendations.push({
                type: 'ethical',
                priority: 'medium',
                message: '🤔 **Recomendación del Concilio**: Esta pregunta contiene dimensiones éticas importantes.',
                source: 'PhilosophyChamber',
                action: 'approach_with_caution'
            });
        }
        
        // Recomendación basada en conocimiento integrado
        if (knowledge?.requiresDeepAnalysis) {
            recommendations.push({
                type: 'complexity',
                priority: 'high',
                message: '🎓 **Recomendación del Concilio**: Esta consulta requiere análisis profundo y consideración de múltiples perspectivas.',
                source: 'KnowledgeAssembly',
                action: 'provide_comprehensive_response'
            });
        }
        
        // Recomendación basada en decisión
        if (decision?.action === 'seek_clarification') {
            recommendations.push({
                type: 'clarification',
                priority: 'medium',
                message: '❓ **Recomendación del Concilio**: Es necesario pedir clarificación antes de responder.',
                source: 'DecisionChamber',
                action: 'ask_for_clarification'
            });
        }
        
        return recommendations;
    }

    /**
     * Establecer prioridades del concilio
     */
    establishCouncilPriorities(analyses, decision) {
        const priorities = [];
        
        // Prioridad 1: Seguridad y ética
        if (analyses.psychology?.needsProfessionalHelp || analyses.philosophy?.isEthicalDilemma) {
            priorities.push({
                level: 1,
                domain: 'safety_ethics',
                description: 'Garantizar seguridad y consideración ética',
                chambers: ['PsychologyChamber', 'PhilosophyChamber']
            });
        }
        
        // Prioridad 2: Calidad de respuesta
        if (decision?.requiresDetailedResponse) {
            priorities.push({
                level: 2,
                domain: 'response_quality',
                description: 'Proporcionar respuesta detallada y bien fundamentada',
                chambers: ['KnowledgeAssembly', 'DecisionChamber']
            });
        }
        
        // Prioridad 3: Claridad y precisión
        priorities.push({
            level: 3,
            domain: 'clarity_precision',
            description: 'Mantener claridad y precisión en la comunicación',
            chambers: ['All Chambers']
        });
        
        return priorities.sort((a, b) => a.level - b.level);
    }

    /**
     * Activar/desactivar módulos específicos
     */
    toggleChamber(chamberName, enable = true) {
        if (this.chambers[chamberName]) {
            if (enable) {
                this.activeModules.add(chamberName);
                this.logCouncilAction('chamber_enabled', `Cámara ${chamberName} activada`);
            } else {
                this.activeModules.delete(chamberName);
                this.logCouncilAction('chamber_disabled', `Cámara ${chamberName} desactivada`);
            }
            return true;
        }
        return false;
    }

    /**
     * Obtener estado del concilio
     */
    getCouncilStatus() {
        return {
            timestamp: new Date().toISOString(),
            activeChambers: Array.from(this.activeModules),
            inactiveChambers: Object.keys(this.chambers).filter(
                chamber => !this.activeModules.has(chamber)
            ),
            councilLogSize: this.councilLog.length,
            lastMeeting: this.councilLog[this.councilLog.length - 1] || null
        };
    }

    /**
     * Obtener estadísticas del concilio
     */
    getCouncilStatistics() {
        const psychologyMeetings = this.councilLog.filter(
            log => log.analyses?.psychology
        ).length;
        
        const philosophyMeetings = this.councilLog.filter(
            log => log.analyses?.philosophy
        ).length;
        
        const decisionsMade = this.councilLog.filter(
            log => log.decision
        ).length;
        
        return {
            totalMeetings: this.councilLog.length,
            psychologyInvolvement: psychologyMeetings,
            philosophyInvolvement: philosophyMeetings,
            decisionsMade,
            averageProcessingTime: this.calculateAverageProcessingTime()
        };
    }

    calculateAverageProcessingTime() {
        if (this.councilLog.length === 0) return 0;
        
        const totalTime = this.councilLog.reduce((sum, log) => 
            sum + (log.processingTime || 0), 0
        );
        
        return Math.round(totalTime / this.councilLog.length);
    }

    /**
     * Loggear acciones del concilio
     */
    logCouncilAction(action, data) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            action,
            data: typeof data === 'string' ? data : JSON.stringify(data)
        };
        
        this.councilLog.push(logEntry);
        
        // Mantener tamaño máximo
        if (this.councilLog.length > this.maxLogSize) {
            this.councilLog.shift();
        }
    }

    /**
     * Añadir al registro del concilio
     */
    addToCouncilLog(meetingResult) {
        const logEntry = {
            id: meetingResult.meetingId,
            timestamp: meetingResult.timestamp,
            questionPreview: meetingResult.question?.substring(0, 50) || 'Sin pregunta',
            decision: meetingResult.decision?.action || 'no_decision',
            processingTime: meetingResult.processingTime,
            hasPsychology: !!meetingResult.analyses?.psychology,
            hasPhilosophy: !!meetingResult.analyses?.philosophy,
            recommendationCount: meetingResult.councilRecommendations?.length || 0
        };
        
        this.councilLog.push(logEntry);
        
        // Mantener tamaño máximo
        if (this.councilLog.length > this.maxLogSize) {
            this.councilLog.shift();
        }
    }

    /**
     * Generar reporte del concilio
     */
    generateCouncilReport(days = 7) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        
        const recentMeetings = this.councilLog.filter(entry => 
            new Date(entry.timestamp) > cutoffDate
        );
        
        const psychologyCount = recentMeetings.filter(m => m.hasPsychology).length;
        const philosophyCount = recentMeetings.filter(m => m.hasPhilosophy).length;
        
        const decisions = {
            direct_response: recentMeetings.filter(m => m.decision === 'direct_response').length,
            seek_clarification: recentMeetings.filter(m => m.decision === 'seek_clarification').length,
            defer_response: recentMeetings.filter(m => m.decision === 'defer_response').length,
            deep_analysis: recentMeetings.filter(m => m.decision === 'deep_analysis').length
        };
        
        return {
            period: `${days} días`,
            totalMeetings: recentMeetings.length,
            psychologyActivations: psychologyCount,
            philosophyActivations: philosophyCount,
            decisionDistribution: decisions,
            avgProcessingTime: this.calculateAverageProcessingTime(),
            mostActiveHour: this.calculateMostActiveHour(recentMeetings),
            recommendationsPerMeeting: recentMeetings.reduce((sum, m) => 
                sum + (m.recommendationCount || 0), 0
            ) / recentMeetings.length || 0
        };
    }

    calculateMostActiveHour(meetings) {
        if (meetings.length === 0) return 'No data';
        
        const hours = meetings.map(m => {
            const date = new Date(m.timestamp);
            return date.getHours();
        });
        
        const hourCounts = {};
        hours.forEach(hour => {
            hourCounts[hour] = (hourCounts[hour] || 0) + 1;
        });
        
        const mostActive = Object.entries(hourCounts).sort((a, b) => b[1] - a[0])[0];
        
        return `${mostActive[0]}:00 - ${mostActive[0]}:59 (${mostActive[1]} reuniones)`;
    }

    /**
     * Resetear concilio
     */
    resetCouncil() {
        this.councilLog = [];
        this.activeModules.clear();
        this.activeModules.add('psychology');
        this.activeModules.add('philosophy');
        this.activeModules.add('decision');
        this.activeModules.add('knowledge');
        
        this.logCouncilAction('reset', 'Concilio resetado completamente');
        
        return {
            success: true,
            message: 'Concilio de Módulos resetado exitosamente',
            activeChambers: Array.from(this.activeModules),
            logCleared: true
        };
    }
}

export default ModuleCouncil;
