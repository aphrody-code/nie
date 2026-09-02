/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import {
	extendZodWithOpenApi,
	OpenApiGeneratorV3,
	OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Étendre Zod avec les méthodes OpenAPI
extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// Enregistrement de la clé de sécurité Bearer Token
registry.registerComponent("securitySchemes", "BearerAuth", {
	type: "http",
	scheme: "bearer",
});

// ─── DÉFINITION DES SCHÉMAS ZOD ET DOCUMENTATION ────────────────────────────

export const HealthResponseSchema = registry.register(
	"HealthResponse",
	z.object({
		status: z.string().openapi({ description: "Statut général du daemon", example: "healthy" }),
		uptime: z.number().openapi({ description: "Uptime du processus en secondes", example: 124.5 }),
		memory: z
			.object({
				rss: z.number(),
				heapTotal: z.number(),
				heapUsed: z.number(),
				external: z.number(),
			})
			.openapi({ description: "Utilisation de la mémoire du processus" }),
		time: z.string().datetime().openapi({ description: "Date et heure actuelle du serveur" }),
		wsConnections: z
			.number()
			.openapi({ description: "Nombre de clients WebSocket connectés", example: 2 }),
	})
);

export const LastExecutionItemSchema = z.object({
	time: z.string().datetime(),
	durationMs: z.number(),
	success: z.boolean(),
	error: z.string().optional(),
});

export const MetricsResponseSchema = registry.register(
	"MetricsResponse",
	z.object({
		startedAt: z.string().datetime().openapi({ description: "Heure de démarrage du daemon" }),
		tasksTriggered: z
			.number()
			.openapi({ description: "Nombre total de tâches lancées", example: 42 }),
		tasksSucceeded: z.number().openapi({ description: "Nombre de tâches réussies", example: 40 }),
		tasksFailed: z.number().openapi({ description: "Nombre de tâches en échec", example: 2 }),
		lastExecution: z.record(z.string(), LastExecutionItemSchema).openapi({
			description: "Historique des dernières exécutions pour chaque tâche",
			example: {
				crawl: {
					time: "2026-05-29T12:00:00Z",
					durationMs: 15200,
					success: true,
				},
			},
		}),
	})
);

export const TasksResponseSchema = registry.register(
	"TasksResponse",
	z.object({
		tasks: z.array(z.string()).openapi({ description: "Liste des noms de tâches disponibles" }),
		schedules: z
			.record(z.string(), z.string())
			.openapi({ description: "Planifications associées (Cron Expressions)" }),
	})
);

export const TaskRunResponseSchema = registry.register(
	"TaskRunResponse",
	z.object({
		success: z.boolean().openapi({ example: true }),
		message: z.string().openapi({ example: 'Tâche "crawl" démarrée en tâche de fond.' }),
	})
);

// Enregistrement de la clé de sécurité Bearer Token
const apiKeyAuth = registry.registerPath({
	method: "post",
	path: "/tasks/{name}/run",
	summary: "Déclencher une tâche à la demande",
	security: [{ BearerAuth: [] }],
	request: {
		params: z.object({
			name: z.string().openapi({ description: "Nom de la tâche à exécuter" }),
		}),
	},
	responses: {
		202: {
			description: "Tâche acceptée et lancée en arrière-plan",
			content: {
				"application/json": {
					schema: TaskRunResponseSchema,
				},
			},
		},
		400: {
			description: "Nom de tâche inconnu",
		},
		401: {
			description: "Non autorisé",
		},
	},
});

// Enregistrement des routes de lecture publique/semi-publique
registry.registerPath({
	method: "get",
	path: "/health",
	summary: "Health Check du Daemon",
	responses: {
		200: {
			description: "Daemon en ligne et sain",
			content: {
				"application/json": {
					schema: HealthResponseSchema,
				},
			},
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/metrics",
	summary: "Métriques de performance des tâches",
	responses: {
		200: {
			description: "Métriques retournées avec succès",
			content: {
				"application/json": {
					schema: MetricsResponseSchema,
				},
			},
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/tasks",
	summary: "Liste et planification des tâches",
	security: [{ BearerAuth: [] }],
	responses: {
		200: {
			description: "Liste des tâches retournée",
			content: {
				"application/json": {
					schema: TasksResponseSchema,
				},
			},
		},
		401: {
			description: "Non autorisé",
		},
	},
});

/**
 * Génère le document OpenAPI v3 final au format JSON.
 */
export function getOpenApiDocument(): Record<string, any> {
	const generator = new OpenApiGeneratorV3(registry.definitions);
	return generator.generateDocument({
		openapi: "3.0.0",
		info: {
			title: "Rose Griffon Cron Daemon API",
			description:
				"API de monitoring et d'administration du daemon de tâches planifiées (rg-cron).",
			version: "1.0.0",
		},
		servers: [
			{
				url: "https://api.rosegriffon.fr",
				description: "API de Production",
			},
			{
				url: "http://localhost:3005",
				description: "Serveur local de développement",
			},
		],
	});
}

/**
 * Retourne le code HTML brut de l'interface Swagger UI configurée pour notre openapi.json.
 */
export function getSwaggerHtml(): string {
	return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Rose Griffon Cron Swagger UI" />
  <title>Rose Griffon Cron API - Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <link rel="icon" type="image/png" href="https://cdn.rosegriffon.fr/static/website/public/favicon.ico" />
  <style>
    html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none; } /* Cacher la barre supérieure par défaut */
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" charset="UTF-8"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js" charset="UTF-8"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout",
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1,
        supportedSubmitMethods: ['get', 'post']
      });
    };
  </script>
</body>
</html>`;
}
