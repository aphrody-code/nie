// Types du schéma PostgreSQL — FICHIER GÉNÉRÉ, NE PAS ÉDITER À LA MAIN.
//
// Régénération : `bun run --filter @rosegriffon/db types:gen`
// (script `packages/db/scripts/types-gen.ts` → endpoint `/generators/typescript`
// de pg-meta en local, le générateur même de `supabase gen types typescript`).
//
// Toute correction se fait EN BASE puis par régénération : une retouche à la
// main est effacée au prochain passage et fait mentir le type sans prévenir.
//
// Pas de bloc `__InternalSupabase.PostgrestVersion` ici : `@supabase/supabase-js`
// retombe alors sur `'12'`, ce qui correspond au PostgREST réellement servi
// (12.2.12, cf. l'en-tête `Server:` de `127.0.0.1:8809`). L'ancienne valeur
// `"14.5"` héritée de Supabase Cloud autorisait `.maxAffected()` au typage
// alors que le serveur ne sait pas l'honorer.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      account: {
        Row: {
          access_token: string | null
          access_token_expires_at: string | null
          account_id: string
          created_at: string
          id: string
          id_token: string | null
          password: string | null
          provider_id: string
          refresh_token: string | null
          refresh_token_expires_at: string | null
          scope: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          access_token_expires_at?: string | null
          account_id: string
          created_at?: string
          id: string
          id_token?: string | null
          password?: string | null
          provider_id: string
          refresh_token?: string | null
          refresh_token_expires_at?: string | null
          scope?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          access_token_expires_at?: string | null
          account_id?: string
          created_at?: string
          id?: string
          id_token?: string | null
          password?: string | null
          provider_id?: string
          refresh_token?: string | null
          refresh_token_expires_at?: string | null
          scope?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          user_id?: string
        }
        Relationships: []
      }
      agent: {
        Row: {
          activatedAt: string | null
          createdAt: string
          expiresAt: string | null
          hostId: string
          id: string
          jwksUrl: string | null
          kid: string | null
          lastUsedAt: string | null
          metadata: string | null
          mode: string
          name: string
          publicKey: string
          status: string
          updatedAt: string
          userId: string | null
        }
        Insert: {
          activatedAt?: string | null
          createdAt: string
          expiresAt?: string | null
          hostId: string
          id: string
          jwksUrl?: string | null
          kid?: string | null
          lastUsedAt?: string | null
          metadata?: string | null
          mode: string
          name: string
          publicKey: string
          status: string
          updatedAt: string
          userId?: string | null
        }
        Update: {
          activatedAt?: string | null
          createdAt?: string
          expiresAt?: string | null
          hostId?: string
          id?: string
          jwksUrl?: string | null
          kid?: string | null
          lastUsedAt?: string | null
          metadata?: string | null
          mode?: string
          name?: string
          publicKey?: string
          status?: string
          updatedAt?: string
          userId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_hostId_fkey"
            columns: ["hostId"]
            referencedRelation: "agentHost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_userId_fkey"
            columns: ["userId"]
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      agentCapabilityGrant: {
        Row: {
          agentId: string
          capability: string
          constraints: string | null
          createdAt: string
          deniedBy: string | null
          expiresAt: string | null
          grantedBy: string | null
          id: string
          reason: string | null
          status: string
          updatedAt: string
        }
        Insert: {
          agentId: string
          capability: string
          constraints?: string | null
          createdAt: string
          deniedBy?: string | null
          expiresAt?: string | null
          grantedBy?: string | null
          id: string
          reason?: string | null
          status: string
          updatedAt: string
        }
        Update: {
          agentId?: string
          capability?: string
          constraints?: string | null
          createdAt?: string
          deniedBy?: string | null
          expiresAt?: string | null
          grantedBy?: string | null
          id?: string
          reason?: string | null
          status?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "agentCapabilityGrant_agentId_fkey"
            columns: ["agentId"]
            referencedRelation: "agent"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentCapabilityGrant_deniedBy_fkey"
            columns: ["deniedBy"]
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentCapabilityGrant_grantedBy_fkey"
            columns: ["grantedBy"]
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      agentHost: {
        Row: {
          activatedAt: string | null
          createdAt: string
          defaultCapabilities: string | null
          enrollmentTokenExpiresAt: string | null
          enrollmentTokenHash: string | null
          expiresAt: string | null
          id: string
          jwksUrl: string | null
          kid: string | null
          lastUsedAt: string | null
          name: string | null
          publicKey: string | null
          status: string
          updatedAt: string
          userId: string | null
        }
        Insert: {
          activatedAt?: string | null
          createdAt: string
          defaultCapabilities?: string | null
          enrollmentTokenExpiresAt?: string | null
          enrollmentTokenHash?: string | null
          expiresAt?: string | null
          id: string
          jwksUrl?: string | null
          kid?: string | null
          lastUsedAt?: string | null
          name?: string | null
          publicKey?: string | null
          status: string
          updatedAt: string
          userId?: string | null
        }
        Update: {
          activatedAt?: string | null
          createdAt?: string
          defaultCapabilities?: string | null
          enrollmentTokenExpiresAt?: string | null
          enrollmentTokenHash?: string | null
          expiresAt?: string | null
          id?: string
          jwksUrl?: string | null
          kid?: string | null
          lastUsedAt?: string | null
          name?: string | null
          publicKey?: string | null
          status?: string
          updatedAt?: string
          userId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agentHost_userId_fkey"
            columns: ["userId"]
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      approvalRequest: {
        Row: {
          agentId: string | null
          bindingMessage: string | null
          capabilities: string | null
          clientNotificationEndpoint: string | null
          clientNotificationToken: string | null
          createdAt: string
          deliveryMode: string | null
          expiresAt: string
          hostId: string | null
          id: string
          interval: number
          lastPolledAt: string | null
          loginHint: string | null
          method: string
          status: string
          updatedAt: string
          userCodeHash: string | null
          userId: string | null
        }
        Insert: {
          agentId?: string | null
          bindingMessage?: string | null
          capabilities?: string | null
          clientNotificationEndpoint?: string | null
          clientNotificationToken?: string | null
          createdAt: string
          deliveryMode?: string | null
          expiresAt: string
          hostId?: string | null
          id: string
          interval: number
          lastPolledAt?: string | null
          loginHint?: string | null
          method: string
          status: string
          updatedAt: string
          userCodeHash?: string | null
          userId?: string | null
        }
        Update: {
          agentId?: string | null
          bindingMessage?: string | null
          capabilities?: string | null
          clientNotificationEndpoint?: string | null
          clientNotificationToken?: string | null
          createdAt?: string
          deliveryMode?: string | null
          expiresAt?: string
          hostId?: string | null
          id?: string
          interval?: number
          lastPolledAt?: string | null
          loginHint?: string | null
          method?: string
          status?: string
          updatedAt?: string
          userCodeHash?: string | null
          userId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approvalRequest_agentId_fkey"
            columns: ["agentId"]
            referencedRelation: "agent"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvalRequest_hostId_fkey"
            columns: ["hostId"]
            referencedRelation: "agentHost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvalRequest_userId_fkey"
            columns: ["userId"]
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      article_bookmarks: {
        Row: {
          article_id: string
          created_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          article_id: string
          created_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          article_id?: string
          created_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      article_categories: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      article_comments: {
        Row: {
          article_id: string
          content: string
          created_at: string
          id: string
          is_edited: boolean
          is_pinned: boolean
          parent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          article_id: string
          content: string
          created_at?: string
          id?: string
          is_edited?: boolean
          is_pinned?: boolean
          parent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          article_id?: string
          content?: string
          created_at?: string
          id?: string
          is_edited?: boolean
          is_pinned?: boolean
          parent_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_comments_article_id_fkey"
            columns: ["article_id"]
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_comments_parent_id_fkey"
            columns: ["parent_id"]
            referencedRelation: "article_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      article_reactions: {
        Row: {
          article_id: string
          created_at: string | null
          id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          article_id: string
          created_at?: string | null
          id?: string
          reaction_type?: string
          user_id: string
        }
        Update: {
          article_id?: string
          created_at?: string | null
          id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: []
      }
      article_series: {
        Row: {
          author_id: string | null
          cover_image_url: string | null
          created_at: string
          description: string | null
          id: string
          slug: string
          title: string
        }
        Insert: {
          author_id?: string | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          slug: string
          title: string
        }
        Update: {
          author_id?: string | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          slug?: string
          title?: string
        }
        Relationships: []
      }
      articles: {
        Row: {
          app: string
          author_id: string | null
          category: string | null
          co_authors: Json | null
          content: string
          created_at: string | null
          excerpt: string | null
          featured_image_alt: string | null
          featured_image_url: string | null
          id: string
          meta_description: string | null
          meta_title: string | null
          pinned: boolean | null
          published_at: string | null
          scheduled_at: string | null
          search_vector: unknown | null
          series_id: string | null
          series_order: number
          share_count: number
          slug: string
          status: string | null
          tags: string[] | null
          title: string
          updated_at: string | null
          view_count: number | null
        }
        Insert: {
          app?: string
          author_id?: string | null
          category?: string | null
          co_authors?: Json | null
          content: string
          created_at?: string | null
          excerpt?: string | null
          featured_image_alt?: string | null
          featured_image_url?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          pinned?: boolean | null
          published_at?: string | null
          scheduled_at?: string | null
          search_vector?: unknown | null
          series_id?: string | null
          series_order?: number
          share_count?: number
          slug: string
          status?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string | null
          view_count?: number | null
        }
        Update: {
          app?: string
          author_id?: string | null
          category?: string | null
          co_authors?: Json | null
          content?: string
          created_at?: string | null
          excerpt?: string | null
          featured_image_alt?: string | null
          featured_image_url?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          pinned?: boolean | null
          published_at?: string | null
          scheduled_at?: string | null
          search_vector?: unknown | null
          series_id?: string | null
          series_order?: number
          share_count?: number
          slug?: string
          status?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "articles_series_id_fkey"
            columns: ["series_id"]
            referencedRelation: "article_series"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          id: string
          ip_address: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      avatar_saves: {
        Row: {
          code: string | null
          cree_le: string
          donnees: Json
          id: string
          modifie_le: string
          nom: string
          user_id: string
        }
        Insert: {
          code?: string | null
          cree_le?: string
          donnees: Json
          id?: string
          modifie_le?: string
          nom?: string
          user_id: string
        }
        Update: {
          code?: string | null
          cree_le?: string
          donnees?: Json
          id?: string
          modifie_le?: string
          nom?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "avatar_saves_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_import_noctaly: {
        Row: {
          discord_id: string
          guild_id: string
          importe_le: string
          profil_eco: Json | null
          profil_niveau: Json | null
        }
        Insert: {
          discord_id: string
          guild_id: string
          importe_le?: string
          profil_eco?: Json | null
          profil_niveau?: Json | null
        }
        Update: {
          discord_id?: string
          guild_id?: string
          importe_le?: string
          profil_eco?: Json | null
          profil_niveau?: Json | null
        }
        Relationships: []
      }
      bot_import_noctaly_catalogue: {
        Row: {
          contenu: Json
          genre: string
          guild_id: string
          importe_le: string
        }
        Insert: {
          contenu: Json
          genre: string
          guild_id: string
          importe_le?: string
        }
        Update: {
          contenu?: Json
          genre?: string
          guild_id?: string
          importe_le?: string
        }
        Relationships: []
      }
      bot_inventaire: {
        Row: {
          categorie: string
          discord_id: string
          guild_id: string
          objet_id: string
          obtenu_le: string
          prix_paye: number
        }
        Insert: {
          categorie: string
          discord_id: string
          guild_id: string
          objet_id: string
          obtenu_le?: string
          prix_paye?: number
        }
        Update: {
          categorie?: string
          discord_id?: string
          guild_id?: string
          objet_id?: string
          obtenu_le?: string
          prix_paye?: number
        }
        Relationships: []
      }
      bot_journal_kizuna: {
        Row: {
          contrepartie: string | null
          cree_le: string
          delta: number
          discord_id: string
          guild_id: string
          id: number
          motif: string
          reference: string | null
        }
        Insert: {
          contrepartie?: string | null
          cree_le?: string
          delta: number
          discord_id: string
          guild_id: string
          id?: number
          motif: string
          reference?: string | null
        }
        Update: {
          contrepartie?: string | null
          cree_le?: string
          delta?: number
          discord_id?: string
          guild_id?: string
          id?: number
          motif?: string
          reference?: string | null
        }
        Relationships: []
      }
      bot_menus_roles: {
        Row: {
          choix_max: number
          cree_le: string
          cree_par: string
          description: string | null
          forme: string
          guild_id: string
          id: number
          maj_le: string
          message_id: string
          roles: Json
          salon_id: string
          titre: string
        }
        Insert: {
          choix_max?: number
          cree_le?: string
          cree_par: string
          description?: string | null
          forme?: string
          guild_id: string
          id?: number
          maj_le?: string
          message_id: string
          roles?: Json
          salon_id: string
          titre: string
        }
        Update: {
          choix_max?: number
          cree_le?: string
          cree_par?: string
          description?: string | null
          forme?: string
          guild_id?: string
          id?: number
          maj_le?: string
          message_id?: string
          roles?: Json
          salon_id?: string
          titre?: string
        }
        Relationships: []
      }
      bot_multicomptes_verdicts: {
        Row: {
          compte_a: string
          compte_b: string
          cree_le: string
          guild_id: string
          id: number
          maj_le: string
          motif: string | null
          par_qui: string | null
          verdict: string
        }
        Insert: {
          compte_a: string
          compte_b: string
          cree_le?: string
          guild_id: string
          id?: number
          maj_le?: string
          motif?: string | null
          par_qui?: string | null
          verdict: string
        }
        Update: {
          compte_a?: string
          compte_b?: string
          cree_le?: string
          guild_id?: string
          id?: number
          maj_le?: string
          motif?: string | null
          par_qui?: string | null
          verdict?: string
        }
        Relationships: []
      }
      bot_profils: {
        Row: {
          cree_le: string
          dernier_gain_le: string | null
          dernier_quotidien_le: string | null
          discord_id: string
          guild_id: string
          jetons: number
          jetons_gagnes: number
          maj_le: string
          messages_comptes: number
          niveau: number
          perso_favori: string | null
          plaque: string | null
          serie_quotidienne: number
          titre: string | null
          xp: number
        }
        Insert: {
          cree_le?: string
          dernier_gain_le?: string | null
          dernier_quotidien_le?: string | null
          discord_id: string
          guild_id: string
          jetons?: number
          jetons_gagnes?: number
          maj_le?: string
          messages_comptes?: number
          niveau?: number
          perso_favori?: string | null
          plaque?: string | null
          serie_quotidienne?: number
          titre?: string | null
          xp?: number
        }
        Update: {
          cree_le?: string
          dernier_gain_le?: string | null
          dernier_quotidien_le?: string | null
          discord_id?: string
          guild_id?: string
          jetons?: number
          jetons_gagnes?: number
          maj_le?: string
          messages_comptes?: number
          niveau?: number
          perso_favori?: string | null
          plaque?: string | null
          serie_quotidienne?: number
          titre?: string | null
          xp?: number
        }
        Relationships: []
      }
      bot_recompenses_niveau: {
        Row: {
          cree_le: string
          cumulable: boolean
          guild_id: string
          niveau: number
          role_id: string
        }
        Insert: {
          cree_le?: string
          cumulable?: boolean
          guild_id: string
          niveau: number
          role_id: string
        }
        Update: {
          cree_le?: string
          cumulable?: boolean
          guild_id?: string
          niveau?: number
          role_id?: string
        }
        Relationships: []
      }
      bot_reglages_guilde: {
        Row: {
          guild_id: string
          maj_le: string
          valeurs: Json
        }
        Insert: {
          guild_id: string
          maj_le?: string
          valeurs?: Json
        }
        Update: {
          guild_id?: string
          maj_le?: string
          valeurs?: Json
        }
        Relationships: []
      }
      bot_suggestions: {
        Row: {
          auteur_id: string
          cree_le: string
          decide_le: string | null
          decide_par: string | null
          guild_id: string
          id: number
          maj_le: string
          message_id: string | null
          motif: string | null
          numero: number
          salon_id: string
          statut: string
          texte: string
        }
        Insert: {
          auteur_id: string
          cree_le?: string
          decide_le?: string | null
          decide_par?: string | null
          guild_id: string
          id?: number
          maj_le?: string
          message_id?: string | null
          motif?: string | null
          numero: number
          salon_id: string
          statut?: string
          texte: string
        }
        Update: {
          auteur_id?: string
          cree_le?: string
          decide_le?: string | null
          decide_par?: string | null
          guild_id?: string
          id?: number
          maj_le?: string
          message_id?: string | null
          motif?: string | null
          numero?: number
          salon_id?: string
          statut?: string
          texte?: string
        }
        Relationships: []
      }
      bot_tickets: {
        Row: {
          auteur_id: string
          categorie: string
          ferme_le: string | null
          ferme_par: string | null
          guild_id: string
          id: number
          maj_le: string
          numero: number
          ouvert_le: string
          pris_le: string | null
          pris_par: string | null
          salon_id: string
          statut: string
          sujet: string | null
        }
        Insert: {
          auteur_id: string
          categorie: string
          ferme_le?: string | null
          ferme_par?: string | null
          guild_id: string
          id?: number
          maj_le?: string
          numero: number
          ouvert_le?: string
          pris_le?: string | null
          pris_par?: string | null
          salon_id: string
          statut?: string
          sujet?: string | null
        }
        Update: {
          auteur_id?: string
          categorie?: string
          ferme_le?: string | null
          ferme_par?: string | null
          guild_id?: string
          id?: number
          maj_le?: string
          numero?: number
          ouvert_le?: string
          pris_le?: string | null
          pris_par?: string | null
          salon_id?: string
          statut?: string
          sujet?: string | null
        }
        Relationships: []
      }
      campagne_creations_discord: {
        Row: {
          a_media: boolean
          campagne_slug: string
          collecte_le: string
          hashtag_trouve: string | null
          images: Json
          masque: boolean
          message_id: string
          mis_en_avant: boolean
          motif_masquage: string | null
          nb_images: number
          publie_le: string | null
        }
        Insert: {
          a_media?: boolean
          campagne_slug: string
          collecte_le?: string
          hashtag_trouve?: string | null
          images?: Json
          masque?: boolean
          message_id: string
          mis_en_avant?: boolean
          motif_masquage?: string | null
          nb_images?: number
          publie_le?: string | null
        }
        Update: {
          a_media?: boolean
          campagne_slug?: string
          collecte_le?: string
          hashtag_trouve?: string | null
          images?: Json
          masque?: boolean
          message_id?: string
          mis_en_avant?: boolean
          motif_masquage?: string | null
          nb_images?: number
          publie_le?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campagne_creations_discord_campagne_slug_fkey"
            columns: ["campagne_slug"]
            referencedRelation: "x_campagnes"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "campagne_creations_discord_message_id_fkey"
            columns: ["message_id"]
            referencedRelation: "discord_messages"
            referencedColumns: ["message_id"]
          },
        ]
      }
      campagne_creations_instagram: {
        Row: {
          a_media: boolean
          auteur_pseudo: string | null
          campagne_slug: string
          collecte_le: string
          hashtag_trouve: string | null
          images: Json
          legende: string | null
          masque: boolean
          mis_en_avant: boolean
          motif_masquage: string | null
          nb_images: number
          origine: string
          permalink: string
          publie_le: string | null
          shortcode: string
          soumis_par: string | null
          verifie_le: string | null
        }
        Insert: {
          a_media?: boolean
          auteur_pseudo?: string | null
          campagne_slug: string
          collecte_le?: string
          hashtag_trouve?: string | null
          images?: Json
          legende?: string | null
          masque?: boolean
          mis_en_avant?: boolean
          motif_masquage?: string | null
          nb_images?: number
          origine?: string
          permalink: string
          publie_le?: string | null
          shortcode: string
          soumis_par?: string | null
          verifie_le?: string | null
        }
        Update: {
          a_media?: boolean
          auteur_pseudo?: string | null
          campagne_slug?: string
          collecte_le?: string
          hashtag_trouve?: string | null
          images?: Json
          legende?: string | null
          masque?: boolean
          mis_en_avant?: boolean
          motif_masquage?: string | null
          nb_images?: number
          origine?: string
          permalink?: string
          publie_le?: string | null
          shortcode?: string
          soumis_par?: string | null
          verifie_le?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campagne_creations_instagram_campagne_slug_fkey"
            columns: ["campagne_slug"]
            referencedRelation: "x_campagnes"
            referencedColumns: ["slug"]
          },
        ]
      }
      chronicles: {
        Row: {
          author_id: string
          category: string
          content: string
          created_at: string | null
          excerpt: string | null
          featured_image: string | null
          id: string
          published: boolean | null
          slug: string
          title: string
          updated_at: string | null
          views_count: number | null
        }
        Insert: {
          author_id: string
          category?: string
          content: string
          created_at?: string | null
          excerpt?: string | null
          featured_image?: string | null
          id?: string
          published?: boolean | null
          slug: string
          title: string
          updated_at?: string | null
          views_count?: number | null
        }
        Update: {
          author_id?: string
          category?: string
          content?: string
          created_at?: string | null
          excerpt?: string | null
          featured_image?: string | null
          id?: string
          published?: boolean | null
          slug?: string
          title?: string
          updated_at?: string | null
          views_count?: number | null
        }
        Relationships: []
      }
      comment_reports: {
        Row: {
          comment_id: string
          created_at: string
          details: string | null
          id: string
          reason: string
          reporter_id: string
          reviewed_by: string | null
          status: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reporter_id: string
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reporter_id?: string
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_reports_comment_id_fkey"
            columns: ["comment_id"]
            referencedRelation: "article_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          content: string
          created_at: string
          id: string
          target_id: string
          target_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          target_id: string
          target_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          target_id?: string
          target_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_executions: {
        Row: {
          demarre_le: string
          duree_ms: number
          erreur: string | null
          expiree: boolean
          hote: string
          id: number
          origine: string
          succes: boolean
          tache: string
          termine_le: string
        }
        Insert: {
          demarre_le: string
          duree_ms: number
          erreur?: string | null
          expiree?: boolean
          hote: string
          id?: never
          origine: string
          succes: boolean
          tache: string
          termine_le: string
        }
        Update: {
          demarre_le?: string
          duree_ms?: number
          erreur?: string | null
          expiree?: boolean
          hote?: string
          id?: never
          origine?: string
          succes?: boolean
          tache?: string
          termine_le?: string
        }
        Relationships: []
      }
      discord_channels: {
        Row: {
          backfill_complete: boolean
          channel_id: string
          guild_id: string
          icon_emoji: string | null
          last_message_id: string | null
          message_count: number
          name: string
          parent_id: string | null
          position: number | null
          suivi: boolean
          synced_at: string | null
          topic: string | null
          type: number
          updated_at: string
        }
        Insert: {
          backfill_complete?: boolean
          channel_id: string
          guild_id: string
          icon_emoji?: string | null
          last_message_id?: string | null
          message_count?: number
          name: string
          parent_id?: string | null
          position?: number | null
          suivi?: boolean
          synced_at?: string | null
          topic?: string | null
          type?: number
          updated_at?: string
        }
        Update: {
          backfill_complete?: boolean
          channel_id?: string
          guild_id?: string
          icon_emoji?: string | null
          last_message_id?: string | null
          message_count?: number
          name?: string
          parent_id?: string | null
          position?: number | null
          suivi?: boolean
          synced_at?: string | null
          topic?: string | null
          type?: number
          updated_at?: string
        }
        Relationships: []
      }
      discord_members: {
        Row: {
          avatar_url: string | null
          discord_id: string
          display_name: string | null
          is_bot: boolean | null
          joined_at: string | null
          left_at: string | null
          nickname: string | null
          premium_since: string | null
          roles: string[] | null
          updated_at: string | null
          username: string
        }
        Insert: {
          avatar_url?: string | null
          discord_id: string
          display_name?: string | null
          is_bot?: boolean | null
          joined_at?: string | null
          left_at?: string | null
          nickname?: string | null
          premium_since?: string | null
          roles?: string[] | null
          updated_at?: string | null
          username: string
        }
        Update: {
          avatar_url?: string | null
          discord_id?: string
          display_name?: string | null
          is_bot?: boolean | null
          joined_at?: string | null
          left_at?: string | null
          nickname?: string | null
          premium_since?: string | null
          roles?: string[] | null
          updated_at?: string | null
          username?: string
        }
        Relationships: []
      }
      discord_messages: {
        Row: {
          attachments: Json
          author_avatar_url: string | null
          author_display_name: string | null
          author_id: string
          author_is_bot: boolean
          author_username: string
          channel_id: string
          content: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          embeds: Json
          guild_id: string
          mentions: Json
          message_id: string
          pinned: boolean
          poll: Json | null
          reactions: Json
          reference_message_id: string | null
          stickers: Json
          synced_at: string
          type: number
        }
        Insert: {
          attachments?: Json
          author_avatar_url?: string | null
          author_display_name?: string | null
          author_id: string
          author_is_bot?: boolean
          author_username: string
          channel_id: string
          content?: string
          created_at: string
          deleted_at?: string | null
          edited_at?: string | null
          embeds?: Json
          guild_id: string
          mentions?: Json
          message_id: string
          pinned?: boolean
          poll?: Json | null
          reactions?: Json
          reference_message_id?: string | null
          stickers?: Json
          synced_at?: string
          type?: number
        }
        Update: {
          attachments?: Json
          author_avatar_url?: string | null
          author_display_name?: string | null
          author_id?: string
          author_is_bot?: boolean
          author_username?: string
          channel_id?: string
          content?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          embeds?: Json
          guild_id?: string
          mentions?: Json
          message_id?: string
          pinned?: boolean
          poll?: Json | null
          reactions?: Json
          reference_message_id?: string | null
          stickers?: Json
          synced_at?: string
          type?: number
        }
        Relationships: [
          {
            foreignKeyName: "discord_messages_channel_id_fkey"
            columns: ["channel_id"]
            referencedRelation: "discord_channels"
            referencedColumns: ["channel_id"]
          },
        ]
      }
      discord_poll_options: {
        Row: {
          emoji: string | null
          label: string
          percentage: number | null
          poll_id: string
          position: number
          votes: number | null
        }
        Insert: {
          emoji?: string | null
          label: string
          percentage?: number | null
          poll_id: string
          position: number
          votes?: number | null
        }
        Update: {
          emoji?: string | null
          label?: string
          percentage?: number | null
          poll_id?: string
          position?: number
          votes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "discord_poll_options_poll_id_fkey"
            columns: ["poll_id"]
            referencedRelation: "discord_polls"
            referencedColumns: ["poll_id"]
          },
        ]
      }
      discord_poll_votes: {
        Row: {
          poll_id: string
          position: number
          user_id: string
          voted_at: string | null
        }
        Insert: {
          poll_id: string
          position: number
          user_id: string
          voted_at?: string | null
        }
        Update: {
          poll_id?: string
          position?: number
          user_id?: string
          voted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discord_poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            referencedRelation: "discord_polls"
            referencedColumns: ["poll_id"]
          },
        ]
      }
      discord_polls: {
        Row: {
          channel_id: string
          command: string | null
          created_at: string
          creator_id: string | null
          creator_username: string | null
          ended: boolean
          ends_at: string | null
          guild_id: string
          language: string | null
          locked: boolean
          max_choices: number
          message_id: string | null
          poll_id: string
          provider: string
          question: string
          raw: Json | null
          results_hidden: boolean
          source: string
          total_voters: number | null
          total_votes: number | null
          updated_at: string
          uuid: string | null
          visual_alt: string | null
          visual_attachment_id: string | null
          visual_height: number | null
          visual_message_id: string | null
          visual_path: string | null
          visual_width: number | null
        }
        Insert: {
          channel_id: string
          command?: string | null
          created_at: string
          creator_id?: string | null
          creator_username?: string | null
          ended?: boolean
          ends_at?: string | null
          guild_id: string
          language?: string | null
          locked?: boolean
          max_choices?: number
          message_id?: string | null
          poll_id: string
          provider?: string
          question: string
          raw?: Json | null
          results_hidden?: boolean
          source?: string
          total_voters?: number | null
          total_votes?: number | null
          updated_at?: string
          uuid?: string | null
          visual_alt?: string | null
          visual_attachment_id?: string | null
          visual_height?: number | null
          visual_message_id?: string | null
          visual_path?: string | null
          visual_width?: number | null
        }
        Update: {
          channel_id?: string
          command?: string | null
          created_at?: string
          creator_id?: string | null
          creator_username?: string | null
          ended?: boolean
          ends_at?: string | null
          guild_id?: string
          language?: string | null
          locked?: boolean
          max_choices?: number
          message_id?: string | null
          poll_id?: string
          provider?: string
          question?: string
          raw?: Json | null
          results_hidden?: boolean
          source?: string
          total_voters?: number | null
          total_votes?: number | null
          updated_at?: string
          uuid?: string | null
          visual_alt?: string | null
          visual_attachment_id?: string | null
          visual_height?: number | null
          visual_message_id?: string | null
          visual_path?: string | null
          visual_width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "discord_polls_channel_id_fkey"
            columns: ["channel_id"]
            referencedRelation: "discord_channels"
            referencedColumns: ["channel_id"]
          },
          {
            foreignKeyName: "discord_polls_message_id_fkey"
            columns: ["message_id"]
            referencedRelation: "discord_messages"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "discord_polls_visual_message_id_fkey"
            columns: ["visual_message_id"]
            referencedRelation: "discord_messages"
            referencedColumns: ["message_id"]
          },
        ]
      }
      discord_roles: {
        Row: {
          color: number | null
          guild_id: string
          icon_url: string | null
          is_hoisted: boolean | null
          is_mentionable: boolean | null
          name: string
          permissions: string | null
          position: number | null
          role_id: string
          updated_at: string | null
        }
        Insert: {
          color?: number | null
          guild_id: string
          icon_url?: string | null
          is_hoisted?: boolean | null
          is_mentionable?: boolean | null
          name: string
          permissions?: string | null
          position?: number | null
          role_id: string
          updated_at?: string | null
        }
        Update: {
          color?: number | null
          guild_id?: string
          icon_url?: string | null
          is_hoisted?: boolean | null
          is_mentionable?: boolean | null
          name?: string
          permissions?: string | null
          position?: number | null
          role_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      discord_roles_catalogue: {
        Row: {
          categorie: string | null
          gere_par_integration: boolean
          guild_id: string
          maj_le: string
          permissions_dangereuses: boolean
          permissions_decodees: string[]
          porteurs_count: number
          role_id: string
          type_integration: string | null
          utilite: string | null
        }
        Insert: {
          categorie?: string | null
          gere_par_integration?: boolean
          guild_id: string
          maj_le?: string
          permissions_dangereuses?: boolean
          permissions_decodees?: string[]
          porteurs_count?: number
          role_id: string
          type_integration?: string | null
          utilite?: string | null
        }
        Update: {
          categorie?: string | null
          gere_par_integration?: boolean
          guild_id?: string
          maj_le?: string
          permissions_dangereuses?: boolean
          permissions_decodees?: string[]
          porteurs_count?: number
          role_id?: string
          type_integration?: string | null
          utilite?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discord_roles_catalogue_role_id_fkey"
            columns: ["role_id"]
            referencedRelation: "discord_roles"
            referencedColumns: ["role_id"]
          },
        ]
      }
      discord_sync_logs: {
        Row: {
          created_at: string | null
          error_count: number | null
          id: string
          message: string | null
          status: string
          total_members: number | null
          updated_count: number | null
        }
        Insert: {
          created_at?: string | null
          error_count?: number | null
          id?: string
          message?: string | null
          status: string
          total_members?: number | null
          updated_count?: number | null
        }
        Update: {
          created_at?: string | null
          error_count?: number | null
          id?: string
          message?: string | null
          status?: string
          total_members?: number | null
          updated_count?: number | null
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          body_html: string
          created_at: string
          description: string | null
          id: string
          slug: string
          subject: string
          updated_at: string
        }
        Insert: {
          body_html: string
          created_at?: string
          description?: string | null
          id?: string
          slug: string
          subject: string
          updated_at?: string
        }
        Update: {
          body_html?: string
          created_at?: string
          description?: string | null
          id?: string
          slug?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          created_at: string
          description: string | null
          end_time: string
          id: string
          image_url: string | null
          location: string | null
          start_time: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          end_time: string
          id?: string
          image_url?: string | null
          location?: string | null
          start_time: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          end_time?: string
          id?: string
          image_url?: string | null
          location?: string | null
          start_time?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      inagle_activity_photos: {
        Row: {
          data: Json | null
          id: string
          image_path: string | null
          reward: number | null
          trophy_id_hex: string | null
          updated_at: string | null
        }
        Insert: {
          data?: Json | null
          id: string
          image_path?: string | null
          reward?: number | null
          trophy_id_hex?: string | null
          updated_at?: string | null
        }
        Update: {
          data?: Json | null
          id?: string
          image_path?: string | null
          reward?: number | null
          trophy_id_hex?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_auras: {
        Row: {
          asset_code: string | null
          description_fr: string | null
          description_ja: string | null
          element_id: number | null
          id: string
          image_url: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          sheet_data: Json | null
          sub_type: string | null
          updated_at: string | null
        }
        Insert: {
          asset_code?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element_id?: number | null
          id: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          sheet_data?: Json | null
          sub_type?: string | null
          updated_at?: string | null
        }
        Update: {
          asset_code?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element_id?: number | null
          id?: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          sheet_data?: Json | null
          sub_type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_awakenings: {
        Row: {
          asset_code: string | null
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          element_id: number | null
          id: string
          image_url: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          sheet_data: Json | null
          sub_type: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          asset_code?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element_id?: number | null
          id: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          sheet_data?: Json | null
          sub_type?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          asset_code?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element_id?: number | null
          id?: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          sheet_data?: Json | null
          sub_type?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_basara: {
        Row: {
          agility: number | null
          alt_moveset: string | null
          alt_position: string | null
          character_id: string
          control: number | null
          element: string | null
          gender: string | null
          intelligence: number | null
          kick: number | null
          moveset: string | null
          name_localised: string | null
          name_romaji: string | null
          passive: string | null
          physical: number | null
          position: string | null
          pressure: number | null
          technique: number | null
        }
        Insert: {
          agility?: number | null
          alt_moveset?: string | null
          alt_position?: string | null
          character_id: string
          control?: number | null
          element?: string | null
          gender?: string | null
          intelligence?: number | null
          kick?: number | null
          moveset?: string | null
          name_localised?: string | null
          name_romaji?: string | null
          passive?: string | null
          physical?: number | null
          position?: string | null
          pressure?: number | null
          technique?: number | null
        }
        Update: {
          agility?: number | null
          alt_moveset?: string | null
          alt_position?: string | null
          character_id?: string
          control?: number | null
          element?: string | null
          gender?: string | null
          intelligence?: number | null
          kick?: number | null
          moveset?: string | null
          name_localised?: string | null
          name_romaji?: string | null
          passive?: string | null
          physical?: number | null
          position?: string | null
          pressure?: number | null
          technique?: number | null
        }
        Relationships: []
      }
      inagle_boost_groups: {
        Row: {
          config_index: number
          data: Json | null
          duration: number | null
          id: string
          resolved_spirit_ids: Json | null
          spirit_indices: Json | null
          updated_at: string | null
        }
        Insert: {
          config_index: number
          data?: Json | null
          duration?: number | null
          id: string
          resolved_spirit_ids?: Json | null
          spirit_indices?: Json | null
          updated_at?: string | null
        }
        Update: {
          config_index?: number
          data?: Json | null
          duration?: number | null
          id?: string
          resolved_spirit_ids?: Json | null
          spirit_indices?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_capsules: {
        Row: {
          data: Json | null
          id: string
          prize_data: Json | null
          updated_at: string | null
        }
        Insert: {
          data?: Json | null
          id: string
          prize_data?: Json | null
          updated_at?: string | null
        }
        Update: {
          data?: Json | null
          id?: string
          prize_data?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_chara_menu_resource: {
        Row: {
          data: Json | null
          id: string
          is_template: boolean | null
          paths: Json | null
          updated_at: string | null
        }
        Insert: {
          data?: Json | null
          id: string
          is_template?: boolean | null
          paths?: Json | null
          updated_at?: string | null
        }
        Update: {
          data?: Json | null
          id?: string
          is_template?: boolean | null
          paths?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_characters: {
        Row: {
          age_group: string | null
          base_slug: string | null
          chara_id: string | null
          constellation: string | null
          constellation_index: number | null
          control_type: string | null
          created_at: string | null
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          element: string | null
          element_id: number | null
          game_appearances: string[] | null
          gender: string | null
          hero_type: string | null
          id: string
          image_url: string | null
          internal_code: string | null
          is_controllable: boolean | null
          is_primary: boolean | null
          model_id: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          nickname: string | null
          position: string | null
          position_id: number | null
          rarity: string | null
          rarity_code: number | null
          rarity_label: string | null
          school_year: string | null
          series: string | null
          sheet_data: Json | null
          skills: Json | null
          slug: string | null
          stat_agilite: number | null
          stat_controle: number | null
          stat_frappe: number | null
          stat_intelligence: number | null
          stat_lv1_agilite: number | null
          stat_lv1_controle: number | null
          stat_lv1_frappe: number | null
          stat_lv1_intelligence: number | null
          stat_lv1_physique: number | null
          stat_lv1_pression: number | null
          stat_lv1_technique: number | null
          stat_physique: number | null
          stat_pression: number | null
          stat_technique: number | null
          stat_total: number | null
          stats: Json | null
          team_id: string | null
          teams: Json | null
          updated_at: string | null
          zukan_hash: string | null
          zukan_order: number | null
        }
        Insert: {
          age_group?: string | null
          base_slug?: string | null
          chara_id?: string | null
          constellation?: string | null
          constellation_index?: number | null
          control_type?: string | null
          created_at?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element?: string | null
          element_id?: number | null
          game_appearances?: string[] | null
          gender?: string | null
          hero_type?: string | null
          id: string
          image_url?: string | null
          internal_code?: string | null
          is_controllable?: boolean | null
          is_primary?: boolean | null
          model_id?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          nickname?: string | null
          position?: string | null
          position_id?: number | null
          rarity?: string | null
          rarity_code?: number | null
          rarity_label?: string | null
          school_year?: string | null
          series?: string | null
          sheet_data?: Json | null
          skills?: Json | null
          slug?: string | null
          stat_agilite?: number | null
          stat_controle?: number | null
          stat_frappe?: number | null
          stat_intelligence?: number | null
          stat_lv1_agilite?: number | null
          stat_lv1_controle?: number | null
          stat_lv1_frappe?: number | null
          stat_lv1_intelligence?: number | null
          stat_lv1_physique?: number | null
          stat_lv1_pression?: number | null
          stat_lv1_technique?: number | null
          stat_physique?: number | null
          stat_pression?: number | null
          stat_technique?: number | null
          stat_total?: number | null
          stats?: Json | null
          team_id?: string | null
          teams?: Json | null
          updated_at?: string | null
          zukan_hash?: string | null
          zukan_order?: number | null
        }
        Update: {
          age_group?: string | null
          base_slug?: string | null
          chara_id?: string | null
          constellation?: string | null
          constellation_index?: number | null
          control_type?: string | null
          created_at?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element?: string | null
          element_id?: number | null
          game_appearances?: string[] | null
          gender?: string | null
          hero_type?: string | null
          id?: string
          image_url?: string | null
          internal_code?: string | null
          is_controllable?: boolean | null
          is_primary?: boolean | null
          model_id?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          nickname?: string | null
          position?: string | null
          position_id?: number | null
          rarity?: string | null
          rarity_code?: number | null
          rarity_label?: string | null
          school_year?: string | null
          series?: string | null
          sheet_data?: Json | null
          skills?: Json | null
          slug?: string | null
          stat_agilite?: number | null
          stat_controle?: number | null
          stat_frappe?: number | null
          stat_intelligence?: number | null
          stat_lv1_agilite?: number | null
          stat_lv1_controle?: number | null
          stat_lv1_frappe?: number | null
          stat_lv1_intelligence?: number | null
          stat_lv1_physique?: number | null
          stat_lv1_pression?: number | null
          stat_lv1_technique?: number | null
          stat_physique?: number | null
          stat_pression?: number | null
          stat_technique?: number | null
          stat_total?: number | null
          stats?: Json | null
          team_id?: string | null
          teams?: Json | null
          updated_at?: string | null
          zukan_hash?: string | null
          zukan_order?: number | null
        }
        Relationships: []
      }
      inagle_chat_emotes: {
        Row: {
          data: Json | null
          emote_id: string | null
          flag_idx: number | null
          id: string
          sort_id: number | null
          stamp_idx: number | null
          text_id: string | null
          type: number | null
          updated_at: string | null
        }
        Insert: {
          data?: Json | null
          emote_id?: string | null
          flag_idx?: number | null
          id: string
          sort_id?: number | null
          stamp_idx?: number | null
          text_id?: string | null
          type?: number | null
          updated_at?: string | null
        }
        Update: {
          data?: Json | null
          emote_id?: string | null
          flag_idx?: number | null
          id?: string
          sort_id?: number | null
          stamp_idx?: number | null
          text_id?: string | null
          type?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_constellations: {
        Row: {
          character_count: number
          character_ids: string[]
          data: Json
          id: string
          idx: number
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          texture_layer: string | null
          texture_rare_star: string | null
          texture_star: string | null
          texture_star_after: string | null
          updated_at: string
        }
        Insert: {
          character_count?: number
          character_ids?: string[]
          data: Json
          id: string
          idx: number
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          texture_layer?: string | null
          texture_rare_star?: string | null
          texture_star?: string | null
          texture_star_after?: string | null
          updated_at?: string
        }
        Update: {
          character_count?: number
          character_ids?: string[]
          data?: Json
          id?: string
          idx?: number
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          texture_layer?: string | null
          texture_rare_star?: string | null
          texture_star?: string | null
          texture_star_after?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      inagle_coordinators: {
        Row: {
          buff: string | null
          element: string | null
          game: string | null
          gender: string | null
          id: number
          image: string | null
          name_hiragana: string | null
          name_kanji: string | null
          name_localised: string | null
          name_romaji: string | null
          passive_no: number | null
          passive_slot: number | null
          playstyle: string | null
          requirements: string | null
          role: string | null
          stat: string | null
        }
        Insert: {
          buff?: string | null
          element?: string | null
          game?: string | null
          gender?: string | null
          id?: number
          image?: string | null
          name_hiragana?: string | null
          name_kanji?: string | null
          name_localised?: string | null
          name_romaji?: string | null
          passive_no?: number | null
          passive_slot?: number | null
          playstyle?: string | null
          requirements?: string | null
          role?: string | null
          stat?: string | null
        }
        Update: {
          buff?: string | null
          element?: string | null
          game?: string | null
          gender?: string | null
          id?: number
          image?: string | null
          name_hiragana?: string | null
          name_kanji?: string | null
          name_localised?: string | null
          name_romaji?: string | null
          passive_no?: number | null
          passive_slot?: number | null
          playstyle?: string | null
          requirements?: string | null
          role?: string | null
          stat?: string | null
        }
        Relationships: []
      }
      inagle_costumes: {
        Row: {
          costume_index: number | null
          data: Json | null
          flag1: number | null
          flag2: number | null
          id: string
          model_ref: string | null
          type: number | null
          updated_at: string | null
        }
        Insert: {
          costume_index?: number | null
          data?: Json | null
          flag1?: number | null
          flag2?: number | null
          id: string
          model_ref?: string | null
          type?: number | null
          updated_at?: string | null
        }
        Update: {
          costume_index?: number | null
          data?: Json | null
          flag1?: number | null
          flag2?: number | null
          id?: string
          model_ref?: string | null
          type?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_custom_passives: {
        Row: {
          buff: string | null
          id: number
          requirements: string | null
          stat: string | null
        }
        Insert: {
          buff?: string | null
          id: number
          requirements?: string | null
          stat?: string | null
        }
        Update: {
          buff?: string | null
          id?: number
          requirements?: string | null
          stat?: string | null
        }
        Relationships: []
      }
      inagle_drop_rates: {
        Row: {
          drop_rarity: number | null
          id: string
          item_id: string | null
          rarity: number | null
          source: string
          source_id: string
          updated_at: string
          weight: number
        }
        Insert: {
          drop_rarity?: number | null
          id: string
          item_id?: string | null
          rarity?: number | null
          source: string
          source_id: string
          updated_at?: string
          weight: number
        }
        Update: {
          drop_rarity?: number | null
          id?: string
          item_id?: string | null
          rarity?: number | null
          source?: string
          source_id?: string
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      inagle_drops: {
        Row: {
          fixed_beans: string | null
          game: string | null
          id: number
          no: number | null
          passive_type: string | null
          requirement: string | null
          stat: string | null
          team: string | null
          value: string | null
        }
        Insert: {
          fixed_beans?: string | null
          game?: string | null
          id?: number
          no?: number | null
          passive_type?: string | null
          requirement?: string | null
          stat?: string | null
          team?: string | null
          value?: string | null
        }
        Update: {
          fixed_beans?: string | null
          game?: string | null
          id?: number
          no?: number | null
          passive_type?: string | null
          requirement?: string | null
          stat?: string | null
          team?: string | null
          value?: string | null
        }
        Relationships: []
      }
      inagle_drops_battles: {
        Row: {
          battle_group_id: number
          data: Json | null
          item_table_id: number | null
          updated_at: string | null
        }
        Insert: {
          battle_group_id: number
          data?: Json | null
          item_table_id?: number | null
          updated_at?: string | null
        }
        Update: {
          battle_group_id?: number
          data?: Json | null
          item_table_id?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_drops_tables: {
        Row: {
          entries: Json | null
          table_id: string
          updated_at: string | null
        }
        Insert: {
          entries?: Json | null
          table_id: string
          updated_at?: string | null
        }
        Update: {
          entries?: Json | null
          table_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_drops_treasures: {
        Row: {
          data: Json | null
          id: string
          items: Json | null
          map_id: string | null
          pos: Json | null
          updated_at: string | null
        }
        Insert: {
          data?: Json | null
          id?: string
          items?: Json | null
          map_id?: string | null
          pos?: Json | null
          updated_at?: string | null
        }
        Update: {
          data?: Json | null
          id?: string
          items?: Json | null
          map_id?: string | null
          pos?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_emblems: {
        Row: {
          base_path: string | null
          data: Json | null
          emblem_id: string
          emblem_name: string
          is_template: boolean
          large_file_path: string | null
          large_tex_name: string | null
          small_file_path: string | null
          small_tex_name: string | null
          updated_at: string
        }
        Insert: {
          base_path?: string | null
          data?: Json | null
          emblem_id: string
          emblem_name: string
          is_template?: boolean
          large_file_path?: string | null
          large_tex_name?: string | null
          small_file_path?: string | null
          small_tex_name?: string | null
          updated_at?: string
        }
        Update: {
          base_path?: string | null
          data?: Json | null
          emblem_id?: string
          emblem_name?: string
          is_template?: boolean
          large_file_path?: string | null
          large_tex_name?: string | null
          small_file_path?: string | null
          small_tex_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      inagle_event_subtitles: {
        Row: {
          data: Json | null
          episode: string
          event_id: string
          line_index: number
          line_label: string | null
          lip_sync: string | null
          show_end: number
          show_start: number
          subtitle_langs: string[]
          t3: number
          t4: number
          text_en: string | null
          text_fr: string | null
          text_hash: number
          text_hash_u: string
          text_ja: string | null
          updated_at: string
        }
        Insert: {
          data?: Json | null
          episode: string
          event_id: string
          line_index: number
          line_label?: string | null
          lip_sync?: string | null
          show_end: number
          show_start: number
          subtitle_langs?: string[]
          t3: number
          t4: number
          text_en?: string | null
          text_fr?: string | null
          text_hash: number
          text_hash_u: string
          text_ja?: string | null
          updated_at?: string
        }
        Update: {
          data?: Json | null
          episode?: string
          event_id?: string
          line_index?: number
          line_label?: string | null
          lip_sync?: string | null
          show_end?: number
          show_start?: number
          subtitle_langs?: string[]
          t3?: number
          t4?: number
          text_en?: string | null
          text_fr?: string | null
          text_hash?: number
          text_hash_u?: string
          text_ja?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      inagle_events: {
        Row: {
          data: Json | null
          dialogue_langs: string[]
          episode: string
          event_id: string
          has_map: boolean
          has_subtitle: boolean
          line_count: number
          subtitle_langs: string[]
          subtitle_rows: number
          updated_at: string
        }
        Insert: {
          data?: Json | null
          dialogue_langs?: string[]
          episode: string
          event_id: string
          has_map?: boolean
          has_subtitle?: boolean
          line_count?: number
          subtitle_langs?: string[]
          subtitle_rows?: number
          updated_at?: string
        }
        Update: {
          data?: Json | null
          dialogue_langs?: string[]
          episode?: string
          event_id?: string
          has_map?: boolean
          has_subtitle?: boolean
          line_count?: number
          subtitle_langs?: string[]
          subtitle_rows?: number
          updated_at?: string
        }
        Relationships: []
      }
      inagle_exp_table: {
        Row: {
          level: number
          need_exp: number
        }
        Insert: {
          level: number
          need_exp: number
        }
        Update: {
          level?: number
          need_exp?: number
        }
        Relationships: []
      }
      inagle_formations: {
        Row: {
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          emblem_url: string | null
          id: string
          image_url: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          power_defense: number | null
          power_offense: number | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          emblem_url?: string | null
          id: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          power_defense?: number | null
          power_offense?: number | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          emblem_url?: string | null
          id?: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          power_defense?: number | null
          power_offense?: number | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_gallery: {
        Row: {
          data: Json | null
          flg_no: number | null
          id: string
          img_path: string | null
          need_token_num: number | null
          thumb_path: string | null
          updated_at: string | null
        }
        Insert: {
          data?: Json | null
          flg_no?: number | null
          id: string
          img_path?: string | null
          need_token_num?: number | null
          thumb_path?: string | null
          updated_at?: string | null
        }
        Update: {
          data?: Json | null
          flg_no?: number | null
          id?: string
          img_path?: string | null
          need_token_num?: number | null
          thumb_path?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_game_assets: {
        Row: {
          bucket: string | null
          buildid: number | null
          cpk: string | null
          exists: boolean
          kind: string | null
          path: string
          sha256: string | null
          size: number | null
          updated_at: string | null
        }
        Insert: {
          bucket?: string | null
          buildid?: number | null
          cpk?: string | null
          exists?: boolean
          kind?: string | null
          path: string
          sha256?: string | null
          size?: number | null
          updated_at?: string | null
        }
        Update: {
          bucket?: string | null
          buildid?: number | null
          cpk?: string | null
          exists?: boolean
          kind?: string | null
          path?: string
          sha256?: string | null
          size?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_growth_tables: {
        Row: {
          chara_rank: number | null
          data: Json
          growth_pattern: number | null
          id: number
          main_position: number | null
          play_style: number | null
          section: string
          sub_position: number | null
        }
        Insert: {
          chara_rank?: number | null
          data: Json
          growth_pattern?: number | null
          id?: number
          main_position?: number | null
          play_style?: number | null
          section: string
          sub_position?: number | null
        }
        Update: {
          chara_rank?: number | null
          data?: Json
          growth_pattern?: number | null
          id?: number
          main_position?: number | null
          play_style?: number | null
          section?: string
          sub_position?: number | null
        }
        Relationships: []
      }
      inagle_heroes: {
        Row: {
          agility: number | null
          character_id: string
          control: number | null
          element: string | null
          gender: string | null
          intelligence: number | null
          kick: number | null
          moveset: string | null
          name_localised: string | null
          name_romaji: string | null
          physical: number | null
          playstyle: string
          position: string | null
          pressure: number | null
          technique: number | null
        }
        Insert: {
          agility?: number | null
          character_id: string
          control?: number | null
          element?: string | null
          gender?: string | null
          intelligence?: number | null
          kick?: number | null
          moveset?: string | null
          name_localised?: string | null
          name_romaji?: string | null
          physical?: number | null
          playstyle: string
          position?: string | null
          pressure?: number | null
          technique?: number | null
        }
        Update: {
          agility?: number | null
          character_id?: string
          control?: number | null
          element?: string | null
          gender?: string | null
          intelligence?: number | null
          kick?: number | null
          moveset?: string | null
          name_localised?: string | null
          name_romaji?: string | null
          physical?: number | null
          playstyle?: string
          position?: string | null
          pressure?: number | null
          technique?: number | null
        }
        Relationships: []
      }
      inagle_icon_inventory: {
        Row: {
          filename: string
          folder: string
          id: string
          mime: string | null
          path: string
          size: number | null
          subfolder: string | null
          updated_at: string | null
        }
        Insert: {
          filename: string
          folder: string
          id: string
          mime?: string | null
          path: string
          size?: number | null
          subfolder?: string | null
          updated_at?: string | null
        }
        Update: {
          filename?: string
          folder?: string
          id?: string
          mime?: string | null
          path?: string
          size?: number | null
          subfolder?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_img_inventory: {
        Row: {
          filename: string
          folder: string
          id: string
          mime: string | null
          path: string
          size: number | null
          subfolder: string | null
          updated_at: string | null
        }
        Insert: {
          filename: string
          folder: string
          id: string
          mime?: string | null
          path: string
          size?: number | null
          subfolder?: string | null
          updated_at?: string | null
        }
        Update: {
          filename?: string
          folder?: string
          id?: string
          mime?: string | null
          path?: string
          size?: number | null
          subfolder?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_items: {
        Row: {
          boost_type: string | null
          buy_price: number | null
          category: string | null
          created_at: string | null
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          effect_value: number | null
          id: string
          image_url: string | null
          internal_code: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          price: number | null
          rarity: number | null
          sell_price: number | null
          sheet_data: Json | null
          shop_names: string[] | null
          shops: Json | null
          stat_boost_1: string | null
          stat_boost_2: string | null
          updated_at: string | null
        }
        Insert: {
          boost_type?: string | null
          buy_price?: number | null
          category?: string | null
          created_at?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          effect_value?: number | null
          id: string
          image_url?: string | null
          internal_code?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          price?: number | null
          rarity?: number | null
          sell_price?: number | null
          sheet_data?: Json | null
          shop_names?: string[] | null
          shops?: Json | null
          stat_boost_1?: string | null
          stat_boost_2?: string | null
          updated_at?: string | null
        }
        Update: {
          boost_type?: string | null
          buy_price?: number | null
          category?: string | null
          created_at?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          effect_value?: number | null
          id?: string
          image_url?: string | null
          internal_code?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          price?: number | null
          rarity?: number | null
          sell_price?: number | null
          sheet_data?: Json | null
          shop_names?: string[] | null
          shops?: Json | null
          stat_boost_1?: string | null
          stat_boost_2?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_keshins: {
        Row: {
          asset_code: string | null
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          element_id: number | null
          has_asset: boolean | null
          id: string
          image_url: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          sheet_data: Json | null
          sub_type: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          asset_code?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element_id?: number | null
          has_asset?: boolean | null
          id: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          sheet_data?: Json | null
          sub_type?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          asset_code?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element_id?: number | null
          has_asset?: boolean | null
          id?: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          sheet_data?: Json | null
          sub_type?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_kizuna_items: {
        Row: {
          name: string
          notes: string | null
          power: number | null
          shop: string | null
          size: string | null
        }
        Insert: {
          name: string
          notes?: string | null
          power?: number | null
          shop?: string | null
          size?: string | null
        }
        Update: {
          name?: string
          notes?: string | null
          power?: number | null
          shop?: string | null
          size?: string | null
        }
        Relationships: []
      }
      inagle_lua_scripts: {
        Row: {
          calls: Json | null
          category: string | null
          crc32_numbers: Json | null
          functions: Json | null
          hash: string | null
          id: string
          name: string
          strings: Json | null
          updated_at: string | null
          version: string | null
        }
        Insert: {
          calls?: Json | null
          category?: string | null
          crc32_numbers?: Json | null
          functions?: Json | null
          hash?: string | null
          id: string
          name: string
          strings?: Json | null
          updated_at?: string | null
          version?: string | null
        }
        Update: {
          calls?: Json | null
          category?: string | null
          crc32_numbers?: Json | null
          functions?: Json | null
          hash?: string | null
          id?: string
          name?: string
          strings?: Json | null
          updated_at?: string | null
          version?: string | null
        }
        Relationships: []
      }
      inagle_manager_passives: {
        Row: {
          coord_common: string | null
          coord_legendary: string | null
          id: number
          manager_common: string | null
          manager_legendary: string | null
          playstyle: string | null
          requirements: string | null
          stat: string | null
        }
        Insert: {
          coord_common?: string | null
          coord_legendary?: string | null
          id: number
          manager_common?: string | null
          manager_legendary?: string | null
          playstyle?: string | null
          requirements?: string | null
          stat?: string | null
        }
        Update: {
          coord_common?: string | null
          coord_legendary?: string | null
          id?: number
          manager_common?: string | null
          manager_legendary?: string | null
          playstyle?: string | null
          requirements?: string | null
          stat?: string | null
        }
        Relationships: []
      }
      inagle_media_assets: {
        Row: {
          category: string
          context: Json | null
          data: Json | null
          folder: string
          id: string
          is_template: boolean | null
          path: string
          sources: Json | null
          updated_at: string | null
        }
        Insert: {
          category: string
          context?: Json | null
          data?: Json | null
          folder: string
          id: string
          is_template?: boolean | null
          path: string
          sources?: Json | null
          updated_at?: string | null
        }
        Update: {
          category?: string
          context?: Json | null
          data?: Json | null
          folder?: string
          id?: string
          is_template?: boolean | null
          path?: string
          sources?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_missions: {
        Row: {
          code: string
          data: Json
          mission_id: string
          name_en: string | null
          name_fr: string | null
          name_id: string | null
          name_ja: string | null
          updated_at: string
        }
        Insert: {
          code: string
          data: Json
          mission_id: string
          name_en?: string | null
          name_fr?: string | null
          name_id?: string | null
          name_ja?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          data?: Json
          mission_id?: string
          name_en?: string | null
          name_fr?: string | null
          name_id?: string | null
          name_ja?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      inagle_miximax: {
        Row: {
          asset_code: string | null
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          element_id: number | null
          has_asset: boolean | null
          icon_code: string | null
          id: string
          image_url: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          sheet_data: Json | null
          sub_type: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          asset_code?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element_id?: number | null
          has_asset?: boolean | null
          icon_code?: string | null
          id: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          sheet_data?: Json | null
          sub_type?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          asset_code?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element_id?: number | null
          has_asset?: boolean | null
          icon_code?: string | null
          id?: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          sheet_data?: Json | null
          sub_type?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_mode_changes: {
        Row: {
          asset_code: string | null
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          element_id: number | null
          id: string
          image_url: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          sheet_data: Json | null
          sub_type: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          asset_code?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element_id?: number | null
          id: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          sheet_data?: Json | null
          sub_type?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          asset_code?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element_id?: number | null
          id?: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          sheet_data?: Json | null
          sub_type?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_nameplates: {
        Row: {
          data: Json | null
          font_style: string | null
          id: string
          image_path: string | null
          name_text_id: string | null
          sort_no: number | null
          updated_at: string | null
        }
        Insert: {
          data?: Json | null
          font_style?: string | null
          id: string
          image_path?: string | null
          name_text_id?: string | null
          sort_no?: number | null
          updated_at?: string | null
        }
        Update: {
          data?: Json | null
          font_style?: string | null
          id?: string
          image_path?: string | null
          name_text_id?: string | null
          sort_no?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_opponent_teams: {
        Row: {
          bg_texture: string | null
          data: Json | null
          difficulty_type: number | null
          game_id: string | null
          id: string
          team_id: string | null
          type: number | null
          updated_at: string | null
        }
        Insert: {
          bg_texture?: string | null
          data?: Json | null
          difficulty_type?: number | null
          game_id?: string | null
          id: string
          team_id?: string | null
          type?: number | null
          updated_at?: string | null
        }
        Update: {
          bg_texture?: string | null
          data?: Json | null
          difficulty_type?: number | null
          game_id?: string | null
          id?: string
          team_id?: string | null
          type?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_override_skills: {
        Row: {
          category_id: number | null
          conditions: Json | null
          created_at: string | null
          element_id: number | null
          id: string
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          power_max: number | null
          power_min: number | null
        }
        Insert: {
          category_id?: number | null
          conditions?: Json | null
          created_at?: string | null
          element_id?: number | null
          id: string
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          power_max?: number | null
          power_min?: number | null
        }
        Update: {
          category_id?: number | null
          conditions?: Json | null
          created_at?: string | null
          element_id?: number | null
          id?: string
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          power_max?: number | null
          power_min?: number | null
        }
        Relationships: []
      }
      inagle_passive_generation: {
        Row: {
          no: number
          passive_id: string
          requirement: string | null
          stat: string | null
        }
        Insert: {
          no: number
          passive_id: string
          requirement?: string | null
          stat?: string | null
        }
        Update: {
          no?: number
          passive_id?: string
          requirement?: string | null
          stat?: string | null
        }
        Relationships: []
      }
      inagle_passive_scaling: {
        Row: {
          advanced_high: string | null
          advanced_low: string | null
          common_high: string | null
          common_low: string | null
          growing_high: string | null
          growing_low: string | null
          id: number
          legendary_high: string | null
          legendary_low: string | null
          requirement: string | null
          stat_affected: string | null
          top_high: string | null
          top_low: string | null
        }
        Insert: {
          advanced_high?: string | null
          advanced_low?: string | null
          common_high?: string | null
          common_low?: string | null
          growing_high?: string | null
          growing_low?: string | null
          id: number
          legendary_high?: string | null
          legendary_low?: string | null
          requirement?: string | null
          stat_affected?: string | null
          top_high?: string | null
          top_low?: string | null
        }
        Update: {
          advanced_high?: string | null
          advanced_low?: string | null
          common_high?: string | null
          common_low?: string | null
          growing_high?: string | null
          growing_low?: string | null
          id?: number
          legendary_high?: string | null
          legendary_low?: string | null
          requirement?: string | null
          stat_affected?: string | null
          top_high?: string | null
          top_low?: string | null
        }
        Relationships: []
      }
      inagle_passives: {
        Row: {
          boost_type: string | null
          category: string | null
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          effect_value: string | null
          id: string
          image_url: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          stat_boost: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          boost_type?: string | null
          category?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          effect_value?: string | null
          id: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          stat_boost?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          boost_type?: string | null
          category?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          effect_value?: string | null
          id?: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          stat_boost?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_performances: {
        Row: {
          data: Json | null
          event_id: string | null
          event_name_text_id: string | null
          id: string
          image_path: string | null
          updated_at: string | null
        }
        Insert: {
          data?: Json | null
          event_id?: string | null
          event_name_text_id?: string | null
          id: string
          image_path?: string | null
          updated_at?: string | null
        }
        Update: {
          data?: Json | null
          event_id?: string | null
          event_name_text_id?: string | null
          id?: string
          image_path?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_phase_titles: {
        Row: {
          data: Json | null
          id: string
          image_path: string | null
          texture_id: string | null
          updated_at: string | null
        }
        Insert: {
          data?: Json | null
          id: string
          image_path?: string | null
          texture_id?: string | null
          updated_at?: string | null
        }
        Update: {
          data?: Json | null
          id?: string
          image_path?: string | null
          texture_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_quests: {
        Row: {
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          display_text: string | null
          id: string
          image_url: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          phase: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          display_text?: string | null
          id: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          phase?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          display_text?: string | null
          id?: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          phase?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_rag_edges: {
        Row: {
          created_at: string
          dst: string
          meta: Json
          relation: string
          src: string
          weight: number
        }
        Insert: {
          created_at?: string
          dst: string
          meta?: Json
          relation: string
          src: string
          weight?: number
        }
        Update: {
          created_at?: string
          dst?: string
          meta?: Json
          relation?: string
          src?: string
          weight?: number
        }
        Relationships: []
      }
      inagle_scene_archives: {
        Row: {
          category: number | null
          chapter_no: number | null
          data: Json | null
          event_id: string | null
          id: string
          image_path: string | null
          title_text_id: string | null
          updated_at: string | null
        }
        Insert: {
          category?: number | null
          chapter_no?: number | null
          data?: Json | null
          event_id?: string | null
          id: string
          image_path?: string | null
          title_text_id?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: number | null
          chapter_no?: number | null
          data?: Json | null
          event_id?: string | null
          id?: string
          image_path?: string | null
          title_text_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_shops: {
        Row: {
          data: Json | null
          id: string
          item_db_id: string | null
          item_hex: string
          item_id: number
          item_name_en: string | null
          item_name_fr: string | null
          item_name_ja: string | null
          name_en: string | null
          name_fr: string | null
          name_hash: number
          name_ja: string | null
          shop_id: number
          slot_index: number | null
          updated_at: string
        }
        Insert: {
          data?: Json | null
          id: string
          item_db_id?: string | null
          item_hex: string
          item_id: number
          item_name_en?: string | null
          item_name_fr?: string | null
          item_name_ja?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_hash: number
          name_ja?: string | null
          shop_id: number
          slot_index?: number | null
          updated_at?: string
        }
        Update: {
          data?: Json | null
          id?: string
          item_db_id?: string | null
          item_hex?: string
          item_id?: number
          item_name_en?: string | null
          item_name_fr?: string | null
          item_name_ja?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_hash?: number
          name_ja?: string | null
          shop_id?: number
          slot_index?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      inagle_skill_technic: {
        Row: {
          data: Json
          formation_chara_len: number
          formation_type: number
          id: string
          lose_sub_motion_name_crc: string
          lose_type: number
          shoot_curve_angle: number
          shoot_curve_height_rate: number
          shoot_curve_mid_rate: number
          updated_at: string
          win_sub_motion_name_crc: string
        }
        Insert: {
          data: Json
          formation_chara_len: number
          formation_type: number
          id: string
          lose_sub_motion_name_crc: string
          lose_type: number
          shoot_curve_angle: number
          shoot_curve_height_rate: number
          shoot_curve_mid_rate: number
          updated_at?: string
          win_sub_motion_name_crc: string
        }
        Update: {
          data?: Json
          formation_chara_len?: number
          formation_type?: number
          id?: string
          lose_sub_motion_name_crc?: string
          lose_type?: number
          shoot_curve_angle?: number
          shoot_curve_height_rate?: number
          shoot_curve_mid_rate?: number
          updated_at?: string
          win_sub_motion_name_crc?: string
        }
        Relationships: []
      }
      inagle_skill_videos: {
        Row: {
          created_at: string
          label: string
          position: number
          poster_url: string | null
          skill_id: string
          source: string
          updated_at: string
          video_url: string
        }
        Insert: {
          created_at?: string
          label: string
          position?: number
          poster_url?: string | null
          skill_id: string
          source?: string
          updated_at?: string
          video_url: string
        }
        Update: {
          created_at?: string
          label?: string
          position?: number
          poster_url?: string | null
          skill_id?: string
          source?: string
          updated_at?: string
          video_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "inagle_skill_videos_skill_id_fkey"
            columns: ["skill_id"]
            referencedRelation: "inagle_skills"
            referencedColumns: ["id"]
          },
        ]
      }
      inagle_skills: {
        Row: {
          category: string | null
          category_id: number | null
          created_at: string | null
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          element: string | null
          element_id: number | null
          evolution_type: string | null
          foul_rate: number | null
          growth_type: string | null
          has_telop: boolean
          hash_id: string | null
          id: string
          image_url: string | null
          internal_code: string | null
          is_eldorado: boolean | null
          is_hyper: boolean | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          partner_count: number | null
          poster_url: string | null
          power_max: number | null
          power_min: number | null
          recast_time: number | null
          sheet_data: Json | null
          skill_effect_bit_flag: number | null
          tags: string[] | null
          tension_cost: number | null
          thumbnail_url: string | null
          tp_cost: number | null
          updated_at: string | null
          video_url: string | null
        }
        Insert: {
          category?: string | null
          category_id?: number | null
          created_at?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element?: string | null
          element_id?: number | null
          evolution_type?: string | null
          foul_rate?: number | null
          growth_type?: string | null
          has_telop?: boolean
          hash_id?: string | null
          id: string
          image_url?: string | null
          internal_code?: string | null
          is_eldorado?: boolean | null
          is_hyper?: boolean | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          partner_count?: number | null
          poster_url?: string | null
          power_max?: number | null
          power_min?: number | null
          recast_time?: number | null
          sheet_data?: Json | null
          skill_effect_bit_flag?: number | null
          tags?: string[] | null
          tension_cost?: number | null
          thumbnail_url?: string | null
          tp_cost?: number | null
          updated_at?: string | null
          video_url?: string | null
        }
        Update: {
          category?: string | null
          category_id?: number | null
          created_at?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element?: string | null
          element_id?: number | null
          evolution_type?: string | null
          foul_rate?: number | null
          growth_type?: string | null
          has_telop?: boolean
          hash_id?: string | null
          id?: string
          image_url?: string | null
          internal_code?: string | null
          is_eldorado?: boolean | null
          is_hyper?: boolean | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          partner_count?: number | null
          poster_url?: string | null
          power_max?: number | null
          power_min?: number | null
          recast_time?: number | null
          sheet_data?: Json | null
          skill_effect_bit_flag?: number | null
          tags?: string[] | null
          tension_cost?: number | null
          thumbnail_url?: string | null
          tp_cost?: number | null
          updated_at?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      inagle_souls: {
        Row: {
          asset_code: string | null
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          element_id: number | null
          id: string
          image_url: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          sheet_data: Json | null
          sub_type: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          asset_code?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element_id?: number | null
          id: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          sheet_data?: Json | null
          sub_type?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          asset_code?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element_id?: number | null
          id?: string
          image_url?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          sheet_data?: Json | null
          sub_type?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_special_tactics: {
        Row: {
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          element: string | null
          element_id: number
          id: string
          internal_code: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          partner_count: number
          partner_ids: Json
          power: number
          recast_time: number
          updated_at: string
        }
        Insert: {
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element?: string | null
          element_id?: number
          id: string
          internal_code?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          partner_count?: number
          partner_ids?: Json
          power?: number
          recast_time?: number
          updated_at?: string
        }
        Update: {
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          element?: string | null
          element_id?: number
          id?: string
          internal_code?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          partner_count?: number
          partner_ids?: Json
          power?: number
          recast_time?: number
          updated_at?: string
        }
        Relationships: []
      }
      inagle_stadiums: {
        Row: {
          condition: string | null
          data: Json | null
          field_index: number | null
          id: string
          image_path: string | null
          updated_at: string | null
        }
        Insert: {
          condition?: string | null
          data?: Json | null
          field_index?: number | null
          id: string
          image_path?: string | null
          updated_at?: string | null
        }
        Update: {
          condition?: string | null
          data?: Json | null
          field_index?: number | null
          id?: string
          image_path?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_star_signs: {
        Row: {
          chara_param_id: string
          chara_rarity: number
          data: Json
          enable_cond: string
          is_remarkable: boolean
          rate_boost_a: number
          rate_boost_b: number
          rate_boost_c: number
          rate_boost_d: number
          rate_default: number
          updated_at: string
        }
        Insert: {
          chara_param_id: string
          chara_rarity: number
          data?: Json
          enable_cond?: string
          is_remarkable?: boolean
          rate_boost_a?: number
          rate_boost_b?: number
          rate_boost_c?: number
          rate_boost_d?: number
          rate_default?: number
          updated_at?: string
        }
        Update: {
          chara_param_id?: string
          chara_rarity?: number
          data?: Json
          enable_cond?: string
          is_remarkable?: boolean
          rate_boost_a?: number
          rate_boost_b?: number
          rate_boost_c?: number
          rate_boost_d?: number
          rate_default?: number
          updated_at?: string
        }
        Relationships: []
      }
      inagle_super_tactics: {
        Row: {
          conditions: Json | null
          crc_id: string
          data: Json
          id: string
          idx: number
          kind: string
          updated_at: string
        }
        Insert: {
          conditions?: Json | null
          crc_id: string
          data: Json
          id: string
          idx: number
          kind: string
          updated_at?: string
        }
        Update: {
          conditions?: Json | null
          crc_id?: string
          data?: Json
          id?: string
          idx?: number
          kind?: string
          updated_at?: string
        }
        Relationships: []
      }
      inagle_tactics: {
        Row: {
          cooldown: number | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          duration: number | null
          effect1: string | null
          effect2: string | null
          effect3: string | null
          element: string | null
          element_id: number | null
          id: string | null
          image_url: string | null
          internal_code: string | null
          name: string
          name_fr: string | null
          name_ja: string | null
          partner_count: number | null
          partner_ids: Json | null
          power: number | null
          recast_time: number | null
          shop: string | null
        }
        Insert: {
          cooldown?: number | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          duration?: number | null
          effect1?: string | null
          effect2?: string | null
          effect3?: string | null
          element?: string | null
          element_id?: number | null
          id?: string | null
          image_url?: string | null
          internal_code?: string | null
          name: string
          name_fr?: string | null
          name_ja?: string | null
          partner_count?: number | null
          partner_ids?: Json | null
          power?: number | null
          recast_time?: number | null
          shop?: string | null
        }
        Update: {
          cooldown?: number | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          duration?: number | null
          effect1?: string | null
          effect2?: string | null
          effect3?: string | null
          element?: string | null
          element_id?: number | null
          id?: string | null
          image_url?: string | null
          internal_code?: string | null
          name?: string
          name_fr?: string | null
          name_ja?: string | null
          partner_count?: number | null
          partner_ids?: Json | null
          power?: number | null
          recast_time?: number | null
          shop?: string | null
        }
        Relationships: []
      }
      inagle_team_build: {
        Row: {
          build_level: number | null
          build_type: number | null
          data: Json
          effect_id: string | null
          effect_ref_id: string | null
          id: string
          idx: number
          multiplier: number | null
          section: string
          threshold: number | null
          type: number | null
          updated_at: string
          value: number | null
        }
        Insert: {
          build_level?: number | null
          build_type?: number | null
          data: Json
          effect_id?: string | null
          effect_ref_id?: string | null
          id: string
          idx: number
          multiplier?: number | null
          section: string
          threshold?: number | null
          type?: number | null
          updated_at?: string
          value?: number | null
        }
        Update: {
          build_level?: number | null
          build_type?: number | null
          data?: Json
          effect_id?: string | null
          effect_ref_id?: string | null
          id?: string
          idx?: number
          multiplier?: number | null
          section?: string
          threshold?: number | null
          type?: number | null
          updated_at?: string
          value?: number | null
        }
        Relationships: []
      }
      inagle_teams: {
        Row: {
          country_code: string | null
          created_at: string | null
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          emblem_url: string | null
          emblems: Json | null
          id: string
          internal_code: string | null
          kits: Json | null
          members: Json | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          region: string | null
          series: string | null
          sheet_data: Json | null
          updated_at: string | null
        }
        Insert: {
          country_code?: string | null
          created_at?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          emblem_url?: string | null
          emblems?: Json | null
          id: string
          internal_code?: string | null
          kits?: Json | null
          members?: Json | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          region?: string | null
          series?: string | null
          sheet_data?: Json | null
          updated_at?: string | null
        }
        Update: {
          country_code?: string | null
          created_at?: string | null
          data?: Json | null
          description_en?: string | null
          description_fr?: string | null
          description_ja?: string | null
          emblem_url?: string | null
          emblems?: Json | null
          id?: string
          internal_code?: string | null
          kits?: Json | null
          members?: Json | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          region?: string | null
          series?: string | null
          sheet_data?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_telop_waza: {
        Row: {
          blank_left_index: number
          blank_right_index: number
          data: Json | null
          eldorado_id: string | null
          left_blanks: Json
          right_blanks: Json
          skill_id: string
          updated_at: string
        }
        Insert: {
          blank_left_index: number
          blank_right_index: number
          data?: Json | null
          eldorado_id?: string | null
          left_blanks?: Json
          right_blanks?: Json
          skill_id: string
          updated_at?: string
        }
        Update: {
          blank_left_index?: number
          blank_right_index?: number
          data?: Json | null
          eldorado_id?: string | null
          left_blanks?: Json
          right_blanks?: Json
          skill_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      inagle_tricks: {
        Row: {
          data: Json | null
          event_id: string | null
          event_id_name: string | null
          fail_event_id: string | null
          fail_event_id_name: string | null
          id: string
          name_ja: string | null
          trick_category: number | null
          trick_category_name: string | null
          trick_id_name: string | null
          updated_at: string | null
        }
        Insert: {
          data?: Json | null
          event_id?: string | null
          event_id_name?: string | null
          fail_event_id?: string | null
          fail_event_id_name?: string | null
          id: string
          name_ja?: string | null
          trick_category?: number | null
          trick_category_name?: string | null
          trick_id_name?: string | null
          updated_at?: string | null
        }
        Update: {
          data?: Json | null
          event_id?: string | null
          event_id_name?: string | null
          fail_event_id?: string | null
          fail_event_id_name?: string | null
          id?: string
          name_ja?: string | null
          trick_category?: number | null
          trick_category_name?: string | null
          trick_id_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inagle_trophies: {
        Row: {
          code: string
          data: Json
          desc_en: string | null
          desc_fr: string | null
          desc_ja: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          trophy_id: string
          updated_at: string
        }
        Insert: {
          code: string
          data?: Json
          desc_en?: string | null
          desc_fr?: string | null
          desc_ja?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          trophy_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          data?: Json
          desc_en?: string | null
          desc_fr?: string | null
          desc_ja?: string | null
          name_en?: string | null
          name_fr?: string | null
          name_ja?: string | null
          trophy_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      inagle_uniforms: {
        Row: {
          data: Json | null
          model_count: number
          model_start: number
          models: Json
          name_id: string
          type_id: number | null
          updated_at: string
        }
        Insert: {
          data?: Json | null
          model_count: number
          model_start: number
          models?: Json
          name_id: string
          type_id?: number | null
          updated_at?: string
        }
        Update: {
          data?: Json | null
          model_count?: number
          model_start?: number
          models?: Json
          name_id?: string
          type_id?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      inagle_video_waza: {
        Row: {
          bgm_name: string | null
          caption_end_frame: number | null
          caption_id: string | null
          caption_name: string | null
          caption_start_frame: number | null
          data: Json | null
          event_id: string
          fede_in_time: number | null
          fede_out_time: number | null
          id: string
          menu_id: string | null
          movie_path: string | null
          staffroll_data_name: string | null
          updated_at: string | null
        }
        Insert: {
          bgm_name?: string | null
          caption_end_frame?: number | null
          caption_id?: string | null
          caption_name?: string | null
          caption_start_frame?: number | null
          data?: Json | null
          event_id: string
          fede_in_time?: number | null
          fede_out_time?: number | null
          id: string
          menu_id?: string | null
          movie_path?: string | null
          staffroll_data_name?: string | null
          updated_at?: string | null
        }
        Update: {
          bgm_name?: string | null
          caption_end_frame?: number | null
          caption_id?: string | null
          caption_name?: string | null
          caption_start_frame?: number | null
          data?: Json | null
          event_id?: string
          fede_in_time?: number | null
          fede_out_time?: number | null
          id?: string
          menu_id?: string | null
          movie_path?: string | null
          staffroll_data_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      merch_products: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          price: number
          stock: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          price: number
          stock?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          price?: number
          stock?: number | null
        }
        Relationships: []
      }
      newsletter_subscriptions: {
        Row: {
          categories: string[] | null
          created_at: string
          email: string
          frequency: string
          id: string
          is_active: boolean
          unsubscribe_token: string
          user_id: string | null
        }
        Insert: {
          categories?: string[] | null
          created_at?: string
          email: string
          frequency?: string
          id?: string
          is_active?: boolean
          unsubscribe_token?: string
          user_id?: string | null
        }
        Update: {
          categories?: string[] | null
          created_at?: string
          email?: string
          frequency?: string
          id?: string
          is_active?: boolean
          unsubscribe_token?: string
          user_id?: string | null
        }
        Relationships: []
      }
      orders: {
        Row: {
          amount_discount_cents: number
          amount_shipping_cents: number
          amount_subtotal_cents: number
          amount_tax_cents: number
          amount_total_cents: number
          created_at: string
          delivered_at: string | null
          id: string
          items: Json
          paid_at: string | null
          patron_discount_applied: boolean
          promotion_code: string | null
          refunded_at: string | null
          shipped_at: string | null
          shipping_address: Json | null
          shipping_email: string | null
          shipping_name: string | null
          shipping_phone: string | null
          status: string
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string
          tracking_carrier: string | null
          tracking_number: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_discount_cents?: number
          amount_shipping_cents?: number
          amount_subtotal_cents?: number
          amount_tax_cents?: number
          amount_total_cents: number
          created_at?: string
          delivered_at?: string | null
          id?: string
          items?: Json
          paid_at?: string | null
          patron_discount_applied?: boolean
          promotion_code?: string | null
          refunded_at?: string | null
          shipped_at?: string | null
          shipping_address?: Json | null
          shipping_email?: string | null
          shipping_name?: string | null
          shipping_phone?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id: string
          tracking_carrier?: string | null
          tracking_number?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_discount_cents?: number
          amount_shipping_cents?: number
          amount_subtotal_cents?: number
          amount_tax_cents?: number
          amount_total_cents?: number
          created_at?: string
          delivered_at?: string | null
          id?: string
          items?: Json
          paid_at?: string | null
          patron_discount_applied?: boolean
          promotion_code?: string | null
          refunded_at?: string | null
          shipped_at?: string | null
          shipping_address?: Json | null
          shipping_email?: string | null
          shipping_name?: string | null
          shipping_phone?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string
          tracking_carrier?: string | null
          tracking_number?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      patch_notes: {
        Row: {
          content_html: string | null
          content_html_fr: string | null
          created_at: string | null
          date: string
          featured_image: string | null
          id: string
          platform: Json
          title: string
          title_fr: string | null
          updated_at: string | null
          url: string
        }
        Insert: {
          content_html?: string | null
          content_html_fr?: string | null
          created_at?: string | null
          date: string
          featured_image?: string | null
          id: string
          platform?: Json
          title: string
          title_fr?: string | null
          updated_at?: string | null
          url: string
        }
        Update: {
          content_html?: string | null
          content_html_fr?: string | null
          created_at?: string | null
          date?: string
          featured_image?: string | null
          id?: string
          platform?: Json
          title?: string
          title_fr?: string | null
          updated_at?: string | null
          url?: string
        }
        Relationships: []
      }
      patreon_admin_owners: {
        Row: {
          created_at: string
          note: string | null
          patreon_user_id: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          patreon_user_id: string
        }
        Update: {
          created_at?: string
          note?: string | null
          patreon_user_id?: string
        }
        Relationships: []
      }
      patreon_legacy_members: {
        Row: {
          currently_entitled_cents: number | null
          discord_user_id: string | null
          email: string | null
          full_name: string | null
          id: string
          imported_at: string
          last_charge_date: string | null
          last_charge_status: string | null
          lifetime_support_cents: number | null
          notification_count: number
          notified_at: string | null
          patreon_member_id: string
          patreon_user_id: string
          patron_status: string
          pledge_cadence: number | null
          pledge_start: string | null
          raw_payload: Json
          reactivated_at: string | null
          resolution_method: string | null
          resolved_at: string | null
          resolved_user_id: string | null
          rg_subscription_ref: string | null
          rg_subscription_status: string
          shipping_address: Json | null
          tier_ids: string[] | null
          tier_titles: string[] | null
        }
        Insert: {
          currently_entitled_cents?: number | null
          discord_user_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          imported_at?: string
          last_charge_date?: string | null
          last_charge_status?: string | null
          lifetime_support_cents?: number | null
          notification_count?: number
          notified_at?: string | null
          patreon_member_id: string
          patreon_user_id: string
          patron_status: string
          pledge_cadence?: number | null
          pledge_start?: string | null
          raw_payload: Json
          reactivated_at?: string | null
          resolution_method?: string | null
          resolved_at?: string | null
          resolved_user_id?: string | null
          rg_subscription_ref?: string | null
          rg_subscription_status?: string
          shipping_address?: Json | null
          tier_ids?: string[] | null
          tier_titles?: string[] | null
        }
        Update: {
          currently_entitled_cents?: number | null
          discord_user_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          imported_at?: string
          last_charge_date?: string | null
          last_charge_status?: string | null
          lifetime_support_cents?: number | null
          notification_count?: number
          notified_at?: string | null
          patreon_member_id?: string
          patreon_user_id?: string
          patron_status?: string
          pledge_cadence?: number | null
          pledge_start?: string | null
          raw_payload?: Json
          reactivated_at?: string | null
          resolution_method?: string | null
          resolved_at?: string | null
          resolved_user_id?: string | null
          rg_subscription_ref?: string | null
          rg_subscription_status?: string
          shipping_address?: Json | null
          tier_ids?: string[] | null
          tier_titles?: string[] | null
        }
        Relationships: []
      }
      patreon_legacy_tiers: {
        Row: {
          amount_cents: number
          description: string | null
          discord_role_ids: string[] | null
          imported_at: string
          patreon_tier_id: string
          patron_count: number | null
          published: boolean | null
          rg_plan_name: string | null
          rg_price_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          description?: string | null
          discord_role_ids?: string[] | null
          imported_at?: string
          patreon_tier_id: string
          patron_count?: number | null
          published?: boolean | null
          rg_plan_name?: string | null
          rg_price_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          description?: string | null
          discord_role_ids?: string[] | null
          imported_at?: string
          patreon_tier_id?: string
          patron_count?: number | null
          published?: boolean | null
          rg_plan_name?: string | null
          rg_price_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      patreon_memberships: {
        Row: {
          address: Json | null
          campaign_id: string | null
          created_at: string
          currently_entitled_cents: number | null
          discord_role_ids: string[]
          discord_user_id: string | null
          fetched_at: string
          id: string
          is_free_trial: boolean | null
          is_gifted: boolean | null
          last_charge_date: string | null
          last_charge_status: string | null
          lifetime_support_cents: number | null
          member_email: string | null
          next_charge_date: string | null
          note: string | null
          patreon_email: string | null
          patreon_full_name: string | null
          patreon_member_id: string | null
          patreon_thumb_url: string | null
          patreon_url: string | null
          patreon_user_id: string
          patron_status: string | null
          pledge_cadence: number | null
          pledge_start: string | null
          raw_identity: Json | null
          scope: string | null
          tier_amounts_cents: number[]
          tier_ids: string[]
          tier_requires_shipping: boolean[]
          tier_titles: string[]
          updated_at: string
          user_id: string
          will_pay_amount_cents: number | null
        }
        Insert: {
          address?: Json | null
          campaign_id?: string | null
          created_at?: string
          currently_entitled_cents?: number | null
          discord_role_ids?: string[]
          discord_user_id?: string | null
          fetched_at?: string
          id?: string
          is_free_trial?: boolean | null
          is_gifted?: boolean | null
          last_charge_date?: string | null
          last_charge_status?: string | null
          lifetime_support_cents?: number | null
          member_email?: string | null
          next_charge_date?: string | null
          note?: string | null
          patreon_email?: string | null
          patreon_full_name?: string | null
          patreon_member_id?: string | null
          patreon_thumb_url?: string | null
          patreon_url?: string | null
          patreon_user_id: string
          patron_status?: string | null
          pledge_cadence?: number | null
          pledge_start?: string | null
          raw_identity?: Json | null
          scope?: string | null
          tier_amounts_cents?: number[]
          tier_ids?: string[]
          tier_requires_shipping?: boolean[]
          tier_titles?: string[]
          updated_at?: string
          user_id: string
          will_pay_amount_cents?: number | null
        }
        Update: {
          address?: Json | null
          campaign_id?: string | null
          created_at?: string
          currently_entitled_cents?: number | null
          discord_role_ids?: string[]
          discord_user_id?: string | null
          fetched_at?: string
          id?: string
          is_free_trial?: boolean | null
          is_gifted?: boolean | null
          last_charge_date?: string | null
          last_charge_status?: string | null
          lifetime_support_cents?: number | null
          member_email?: string | null
          next_charge_date?: string | null
          note?: string | null
          patreon_email?: string | null
          patreon_full_name?: string | null
          patreon_member_id?: string | null
          patreon_thumb_url?: string | null
          patreon_url?: string | null
          patreon_user_id?: string
          patron_status?: string | null
          pledge_cadence?: number | null
          pledge_start?: string | null
          raw_identity?: Json | null
          scope?: string | null
          tier_amounts_cents?: number[]
          tier_ids?: string[]
          tier_requires_shipping?: boolean[]
          tier_titles?: string[]
          updated_at?: string
          user_id?: string
          will_pay_amount_cents?: number | null
        }
        Relationships: []
      }
      patreon_oauth_tokens: {
        Row: {
          access_token_enc: string
          created_at: string
          expires_at: string
          id: string
          is_creator: boolean
          patreon_user_id: string
          refresh_token_enc: string
          scope: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token_enc: string
          created_at?: string
          expires_at: string
          id?: string
          is_creator?: boolean
          patreon_user_id: string
          refresh_token_enc: string
          scope: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token_enc?: string
          created_at?: string
          expires_at?: string
          id?: string
          is_creator?: boolean
          patreon_user_id?: string
          refresh_token_enc?: string
          scope?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      patreon_post_events: {
        Row: {
          campaign_id: string | null
          content_excerpt: string | null
          created_at: string
          embed_data: Json | null
          embed_url: string | null
          is_paid: boolean | null
          is_public: boolean | null
          patreon_post_id: string
          published_at: string | null
          raw_payload: Json
          title: string | null
          trigger: string
          updated_at: string
          url: string | null
        }
        Insert: {
          campaign_id?: string | null
          content_excerpt?: string | null
          created_at?: string
          embed_data?: Json | null
          embed_url?: string | null
          is_paid?: boolean | null
          is_public?: boolean | null
          patreon_post_id: string
          published_at?: string | null
          raw_payload: Json
          title?: string | null
          trigger: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          campaign_id?: string | null
          content_excerpt?: string | null
          created_at?: string
          embed_data?: Json | null
          embed_url?: string | null
          is_paid?: boolean | null
          is_public?: boolean | null
          patreon_post_id?: string
          published_at?: string | null
          raw_payload?: Json
          title?: string | null
          trigger?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      patreon_post_images: {
        Row: {
          content_type: string | null
          created_at: string
          id: number
          original_url: string
          patreon_post_id: string
          position: number
          sha256: string
          size_bytes: number | null
          storage_path: string
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          id?: never
          original_url: string
          patreon_post_id: string
          position?: number
          sha256: string
          size_bytes?: number | null
          storage_path: string
        }
        Update: {
          content_type?: string | null
          created_at?: string
          id?: never
          original_url?: string
          patreon_post_id?: string
          position?: number
          sha256?: string
          size_bytes?: number | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "patreon_post_images_patreon_post_id_fkey"
            columns: ["patreon_post_id"]
            referencedRelation: "patreon_post_events"
            referencedColumns: ["patreon_post_id"]
          },
        ]
      }
      patreon_webhook_events: {
        Row: {
          error: string | null
          id: string
          payload: Json
          processed_at: string | null
          received_at: string
          signature_valid: boolean
          status: string
          trigger: string
        }
        Insert: {
          error?: string | null
          id: string
          payload: Json
          processed_at?: string | null
          received_at?: string
          signature_valid: boolean
          status?: string
          trigger: string
        }
        Update: {
          error?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          received_at?: string
          signature_valid?: boolean
          status?: string
          trigger?: string
        }
        Relationships: []
      }
      patreon_webhook_state: {
        Row: {
          id: number
          last_attempted_at: string | null
          last_event_id: string | null
          last_received_at: string | null
          last_trigger: string | null
          num_consecutive_times_failed: number | null
          patreon_webhook_id: string | null
          paused: boolean | null
          total_failed: number
          total_received: number
          triggers: string[]
          updated_at: string
          uri: string
        }
        Insert: {
          id?: number
          last_attempted_at?: string | null
          last_event_id?: string | null
          last_received_at?: string | null
          last_trigger?: string | null
          num_consecutive_times_failed?: number | null
          patreon_webhook_id?: string | null
          paused?: boolean | null
          total_failed?: number
          total_received?: number
          triggers?: string[]
          updated_at?: string
          uri?: string
        }
        Update: {
          id?: number
          last_attempted_at?: string | null
          last_event_id?: string | null
          last_received_at?: string | null
          last_trigger?: string | null
          num_consecutive_times_failed?: number | null
          patreon_webhook_id?: string | null
          paused?: boolean | null
          total_failed?: number
          total_received?: number
          triggers?: string[]
          updated_at?: string
          uri?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          avatar_url: string | null
          badges: string[] | null
          banner_position: number
          banner_url: string | null
          bio: string | null
          city: string | null
          claimed_at: string | null
          country: string | null
          discord_id: string | null
          email: string | null
          full_name: string | null
          id: string
          patreon_id: string | null
          postal_code: string | null
          poste: string | null
          role: string | null
          twitter_handle: string | null
          updated_at: string | null
          username: string | null
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          badges?: string[] | null
          banner_position?: number
          banner_url?: string | null
          bio?: string | null
          city?: string | null
          claimed_at?: string | null
          country?: string | null
          discord_id?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          patreon_id?: string | null
          postal_code?: string | null
          poste?: string | null
          role?: string | null
          twitter_handle?: string | null
          updated_at?: string | null
          username?: string | null
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          badges?: string[] | null
          banner_position?: number
          banner_url?: string | null
          bio?: string | null
          city?: string | null
          claimed_at?: string | null
          country?: string | null
          discord_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          patreon_id?: string | null
          postal_code?: string | null
          poste?: string | null
          role?: string | null
          twitter_handle?: string | null
          updated_at?: string | null
          username?: string | null
          website?: string | null
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          count: number | null
          key: string
          last_request: string
        }
        Insert: {
          count?: number | null
          key: string
          last_request?: string
        }
        Update: {
          count?: number | null
          key?: string
          last_request?: string
        }
        Relationships: []
      }
      reading_history: {
        Row: {
          article_id: string
          id: string
          last_read_at: string
          progress: number
          read_count: number
          user_id: string
        }
        Insert: {
          article_id: string
          id?: string
          last_read_at?: string
          progress?: number
          read_count?: number
          user_id: string
        }
        Update: {
          article_id?: string
          id?: string
          last_read_at?: string
          progress?: number
          read_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reading_history_article_id_fkey"
            columns: ["article_id"]
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      session: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          ip_address: string | null
          token: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id: string
          ip_address?: string | null
          token: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          ip_address?: string | null
          token?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      share_tracking: {
        Row: {
          article_id: string
          created_at: string
          id: string
          platform: string
          user_id: string | null
        }
        Insert: {
          article_id: string
          created_at?: string
          id?: string
          platform: string
          user_id?: string | null
        }
        Update: {
          article_id?: string
          created_at?: string
          id?: string
          platform?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "share_tracking_article_id_fkey"
            columns: ["article_id"]
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      stream_schedules: {
        Row: {
          category: string | null
          created_at: string
          day_of_week: number
          end_time: string | null
          id: string
          notes: string | null
          start_time: string | null
          status: string | null
          streamer_name: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          day_of_week: number
          end_time?: string | null
          id?: string
          notes?: string | null
          start_time?: string | null
          status?: string | null
          streamer_name: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          day_of_week?: number
          end_time?: string | null
          id?: string
          notes?: string | null
          start_time?: string | null
          status?: string | null
          streamer_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          created_at: string
          discord_user_id: string | null
          display_index: number | null
          id: string
          image_url: string | null
          is_active: boolean | null
          member_link: string | null
          name: string
          order_index: number | null
          role: string
          source: string | null
          team_id: string
          team_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          discord_user_id?: string | null
          display_index?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          member_link?: string | null
          name: string
          order_index?: number | null
          role: string
          source?: string | null
          team_id: string
          team_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          discord_user_id?: string | null
          display_index?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          member_link?: string | null
          name?: string
          order_index?: number | null
          role?: string
          source?: string | null
          team_id?: string
          team_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      topics: {
        Row: {
          category: string | null
          content_html: string | null
          created_at: string | null
          date: string
          id: string
          images: Json | null
          thumbnail: string | null
          title: string
          updated_at: string | null
          url: string
        }
        Insert: {
          category?: string | null
          content_html?: string | null
          created_at?: string | null
          date: string
          id: string
          images?: Json | null
          thumbnail?: string | null
          title: string
          updated_at?: string | null
          url: string
        }
        Update: {
          category?: string | null
          content_html?: string | null
          created_at?: string | null
          date?: string
          id?: string
          images?: Json | null
          thumbnail?: string | null
          title?: string
          updated_at?: string | null
          url?: string
        }
        Relationships: []
      }
      tweet_notification_curseurs: {
        Row: {
          annonces: number
          canal: string
          curseur_le: string
          dernier_tweet_id: string | null
          maj_le: string
        }
        Insert: {
          annonces?: number
          canal: string
          curseur_le: string
          dernier_tweet_id?: string | null
          maj_le?: string
        }
        Update: {
          annonces?: number
          canal?: string
          curseur_le?: string
          dernier_tweet_id?: string | null
          maj_le?: string
        }
        Relationships: []
      }
      tweets: {
        Row: {
          author_id: string | null
          author_name: string | null
          author_username: string | null
          category: string | null
          created_at: string | null
          id: string
          is_thread: boolean | null
          media: Json | null
          metrics: Json | null
          quoted_tweets: Json | null
          raw_tweets: Json | null
          text: string | null
          translation: string | null
          tweet_count: number | null
          updated_at: string | null
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          author_username?: string | null
          category?: string | null
          created_at?: string | null
          id: string
          is_thread?: boolean | null
          media?: Json | null
          metrics?: Json | null
          quoted_tweets?: Json | null
          raw_tweets?: Json | null
          text?: string | null
          translation?: string | null
          tweet_count?: number | null
          updated_at?: string | null
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          author_username?: string | null
          category?: string | null
          created_at?: string | null
          id?: string
          is_thread?: boolean | null
          media?: Json | null
          metrics?: Json | null
          quoted_tweets?: Json | null
          raw_tweets?: Json | null
          text?: string | null
          translation?: string | null
          tweet_count?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      two_factor: {
        Row: {
          backup_codes: string
          failed_verification_count: number
          id: string
          locked_until: string | null
          secret: string
          user_id: string
          verified: boolean
        }
        Insert: {
          backup_codes: string
          failed_verification_count?: number
          id: string
          locked_until?: string | null
          secret: string
          user_id: string
          verified?: boolean
        }
        Update: {
          backup_codes?: string
          failed_verification_count?: number
          id?: string
          locked_until?: string | null
          secret?: string
          user_id?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "two_factor_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      user: {
        Row: {
          created_at: string
          email: string
          email_verified: boolean
          id: string
          image: string | null
          name: string
          steam_id: string | null
          two_factor_backup_codes: string | null
          two_factor_enabled: boolean
          two_factor_secret: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          email_verified?: boolean
          id: string
          image?: string | null
          name: string
          steam_id?: string | null
          two_factor_backup_codes?: string | null
          two_factor_enabled?: boolean
          two_factor_secret?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          email_verified?: boolean
          id?: string
          image?: string | null
          name?: string
          steam_id?: string | null
          two_factor_backup_codes?: string | null
          two_factor_enabled?: boolean
          two_factor_secret?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          email_notifications: boolean
          font_size: string
          preferred_categories: string[] | null
          push_notifications: boolean
          reading_mode: boolean
          reduced_motion: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          email_notifications?: boolean
          font_size?: string
          preferred_categories?: string[] | null
          push_notifications?: boolean
          reading_mode?: boolean
          reduced_motion?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          email_notifications?: boolean
          font_size?: string
          preferred_categories?: string[] | null
          push_notifications?: boolean
          reading_mode?: boolean
          reduced_motion?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_teams: {
        Row: {
          created_at: string
          formation_data: Json
          formation_id: string
          id: string
          is_public: boolean | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          formation_data?: Json
          formation_id: string
          id?: string
          is_public?: boolean | null
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          formation_data?: Json
          formation_id?: string
          id?: string
          is_public?: boolean | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_teams_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      verification: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          identifier: string
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id: string
          identifier: string
          updated_at?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          identifier?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      wiki_overrides: {
        Row: {
          created_at: string | null
          entity_id: string
          entity_type: string
          field_path: string
          id: string
          value: Json
        }
        Insert: {
          created_at?: string | null
          entity_id: string
          entity_type: string
          field_path: string
          id?: string
          value: Json
        }
        Update: {
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          field_path?: string
          id?: string
          value?: Json
        }
        Relationships: []
      }
      x_campagne_curseurs: {
        Row: {
          campagne_slug: string
          curseur: string | null
          dernier_arret: string | null
          dernier_id: string | null
          maj_le: string
          pages_lues: number
          requete: string
        }
        Insert: {
          campagne_slug: string
          curseur?: string | null
          dernier_arret?: string | null
          dernier_id?: string | null
          maj_le?: string
          pages_lues?: number
          requete: string
        }
        Update: {
          campagne_slug?: string
          curseur?: string | null
          dernier_arret?: string | null
          dernier_id?: string | null
          maj_le?: string
          pages_lues?: number
          requete?: string
        }
        Relationships: [
          {
            foreignKeyName: "x_campagne_curseurs_campagne_slug_fkey"
            columns: ["campagne_slug"]
            referencedRelation: "x_campagnes"
            referencedColumns: ["slug"]
          },
        ]
      }
      x_campagne_oeuvres: {
        Row: {
          campagne_slug: string
          cle: string
          construit_le: string
          creation_gardee_id: string
          creation_gardee_source: string
          creations: Json
          dhash: string | null
          hauteur: number | null
          image_master_chemin: string | null
          image_master_id: string | null
          image_master_index: number
          image_master_source: string | null
          image_master_url: string | null
          largeur: number | null
          motif_regroupement: string | null
          nb_creations: number
          oeuvre_id: string
          phash: string | null
          sha256: string | null
        }
        Insert: {
          campagne_slug: string
          cle: string
          construit_le?: string
          creation_gardee_id: string
          creation_gardee_source: string
          creations?: Json
          dhash?: string | null
          hauteur?: number | null
          image_master_chemin?: string | null
          image_master_id?: string | null
          image_master_index?: number
          image_master_source?: string | null
          image_master_url?: string | null
          largeur?: number | null
          motif_regroupement?: string | null
          nb_creations?: number
          oeuvre_id: string
          phash?: string | null
          sha256?: string | null
        }
        Update: {
          campagne_slug?: string
          cle?: string
          construit_le?: string
          creation_gardee_id?: string
          creation_gardee_source?: string
          creations?: Json
          dhash?: string | null
          hauteur?: number | null
          image_master_chemin?: string | null
          image_master_id?: string | null
          image_master_index?: number
          image_master_source?: string | null
          image_master_url?: string | null
          largeur?: number | null
          motif_regroupement?: string | null
          nb_creations?: number
          oeuvre_id?: string
          phash?: string | null
          sha256?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "x_campagne_oeuvres_campagne_slug_cle_fkey"
            columns: ["campagne_slug", "cle"]
            referencedRelation: "x_campagne_participants"
            referencedColumns: ["campagne_slug", "cle"]
          },
          {
            foreignKeyName: "x_campagne_oeuvres_campagne_slug_fkey"
            columns: ["campagne_slug"]
            referencedRelation: "x_campagnes"
            referencedColumns: ["slug"]
          },
        ]
      }
      x_campagne_participants: {
        Row: {
          campagne_slug: string
          cle: string
          construit_le: string
          derniere_le: string | null
          eligible: boolean
          fusionne_dans: string | null
          identifiants: Json
          motif_ineligible: string | null
          nb_creations_brutes: number
          nb_oeuvres: number
          notes: string | null
          premiere_le: string | null
          pseudo_affichage: string
          sources: string[]
          updated_at: string
          verrouille: boolean
        }
        Insert: {
          campagne_slug: string
          cle: string
          construit_le?: string
          derniere_le?: string | null
          eligible?: boolean
          fusionne_dans?: string | null
          identifiants?: Json
          motif_ineligible?: string | null
          nb_creations_brutes?: number
          nb_oeuvres?: number
          notes?: string | null
          premiere_le?: string | null
          pseudo_affichage: string
          sources?: string[]
          updated_at?: string
          verrouille?: boolean
        }
        Update: {
          campagne_slug?: string
          cle?: string
          construit_le?: string
          derniere_le?: string | null
          eligible?: boolean
          fusionne_dans?: string | null
          identifiants?: Json
          motif_ineligible?: string | null
          nb_creations_brutes?: number
          nb_oeuvres?: number
          notes?: string | null
          premiere_le?: string | null
          pseudo_affichage?: string
          sources?: string[]
          updated_at?: string
          verrouille?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "x_campagne_participants_campagne_slug_fkey"
            columns: ["campagne_slug"]
            referencedRelation: "x_campagnes"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "x_campagne_participants_campagne_slug_fusionne_dans_fkey"
            columns: ["campagne_slug", "fusionne_dans"]
            referencedRelation: "x_campagne_participants"
            referencedColumns: ["campagne_slug", "cle"]
          },
        ]
      }
      x_campagne_posts: {
        Row: {
          a_media: boolean
          campagne_slug: string
          collecte_le: string
          hashtag_trouve: string | null
          masque: boolean
          mis_en_avant: boolean
          motif_masquage: string | null
          nb_images: number
          publie_le: string | null
          tweet_id: string
        }
        Insert: {
          a_media?: boolean
          campagne_slug: string
          collecte_le?: string
          hashtag_trouve?: string | null
          masque?: boolean
          mis_en_avant?: boolean
          motif_masquage?: string | null
          nb_images?: number
          publie_le?: string | null
          tweet_id: string
        }
        Update: {
          a_media?: boolean
          campagne_slug?: string
          collecte_le?: string
          hashtag_trouve?: string | null
          masque?: boolean
          mis_en_avant?: boolean
          motif_masquage?: string | null
          nb_images?: number
          publie_le?: string | null
          tweet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "x_campagne_posts_campagne_slug_fkey"
            columns: ["campagne_slug"]
            referencedRelation: "x_campagnes"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "x_campagne_posts_tweet_id_fkey"
            columns: ["tweet_id"]
            referencedRelation: "tweets"
            referencedColumns: ["id"]
          },
        ]
      }
      x_campagne_relais: {
        Row: {
          campagne_slug: string
          message_id: string | null
          poste_le: string
          reference_id: string
          salon_id: string
          saute_motif: string | null
          source: string
        }
        Insert: {
          campagne_slug: string
          message_id?: string | null
          poste_le?: string
          reference_id: string
          salon_id: string
          saute_motif?: string | null
          source: string
        }
        Update: {
          campagne_slug?: string
          message_id?: string | null
          poste_le?: string
          reference_id?: string
          salon_id?: string
          saute_motif?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "x_campagne_relais_campagne_slug_fkey"
            columns: ["campagne_slug"]
            referencedRelation: "x_campagnes"
            referencedColumns: ["slug"]
          },
        ]
      }
      x_campagne_tirage_entrees: {
        Row: {
          cle: string
          cle_tri: number | null
          empreinte: string | null
          oeuvres: string[]
          poids: number
          pseudo_affichage: string
          rang: number | null
          tirage_id: string
          u: number | null
        }
        Insert: {
          cle: string
          cle_tri?: number | null
          empreinte?: string | null
          oeuvres?: string[]
          poids: number
          pseudo_affichage: string
          rang?: number | null
          tirage_id: string
          u?: number | null
        }
        Update: {
          cle?: string
          cle_tri?: number | null
          empreinte?: string | null
          oeuvres?: string[]
          poids?: number
          pseudo_affichage?: string
          rang?: number | null
          tirage_id?: string
          u?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "x_campagne_tirage_entrees_tirage_id_fkey"
            columns: ["tirage_id"]
            referencedRelation: "x_campagne_tirages"
            referencedColumns: ["id"]
          },
        ]
      }
      x_campagne_tirage_gagnants: {
        Row: {
          cle: string
          creation_identifiant: string
          creation_source: string
          lot: string | null
          oeuvre_id: string | null
          pseudo_affichage: string
          rang: number
          tirage_id: string
        }
        Insert: {
          cle: string
          creation_identifiant: string
          creation_source: string
          lot?: string | null
          oeuvre_id?: string | null
          pseudo_affichage: string
          rang: number
          tirage_id: string
        }
        Update: {
          cle?: string
          creation_identifiant?: string
          creation_source?: string
          lot?: string | null
          oeuvre_id?: string | null
          pseudo_affichage?: string
          rang?: number
          tirage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "x_campagne_tirage_gagnants_tirage_id_cle_fkey"
            columns: ["tirage_id", "cle"]
            referencedRelation: "x_campagne_tirage_entrees"
            referencedColumns: ["tirage_id", "cle"]
          },
          {
            foreignKeyName: "x_campagne_tirage_gagnants_tirage_id_fkey"
            columns: ["tirage_id"]
            referencedRelation: "x_campagne_tirages"
            referencedColumns: ["id"]
          },
        ]
      }
      x_campagne_tirages: {
        Row: {
          annonce_discord_message_id: string | null
          annonce_discord_salon_id: string | null
          annonce_le: string | null
          annule_le: string | null
          balise_chaine: string | null
          balise_recuperee_le: string | null
          balise_reseau: string | null
          balise_round: number | null
          balise_signature: string | null
          campagne_slug: string
          effectue_le: string | null
          effectue_par: string | null
          empreinte_engagement: string
          empreinte_graine: string | null
          empreinte_participants: string
          engagement_le: string
          engagement_message_id: string | null
          graine: string | null
          graine_origine: string
          id: string
          motif_annulation: string | null
          nb_gagnants: number
          nb_participants: number
          numero: number
          parametres: Json
          poids_mode: string
          publie: boolean
          publie_le: string | null
        }
        Insert: {
          annonce_discord_message_id?: string | null
          annonce_discord_salon_id?: string | null
          annonce_le?: string | null
          annule_le?: string | null
          balise_chaine?: string | null
          balise_recuperee_le?: string | null
          balise_reseau?: string | null
          balise_round?: number | null
          balise_signature?: string | null
          campagne_slug: string
          effectue_le?: string | null
          effectue_par?: string | null
          empreinte_engagement: string
          empreinte_graine?: string | null
          empreinte_participants: string
          engagement_le?: string
          engagement_message_id?: string | null
          graine?: string | null
          graine_origine: string
          id?: string
          motif_annulation?: string | null
          nb_gagnants: number
          nb_participants: number
          numero: number
          parametres?: Json
          poids_mode: string
          publie?: boolean
          publie_le?: string | null
        }
        Update: {
          annonce_discord_message_id?: string | null
          annonce_discord_salon_id?: string | null
          annonce_le?: string | null
          annule_le?: string | null
          balise_chaine?: string | null
          balise_recuperee_le?: string | null
          balise_reseau?: string | null
          balise_round?: number | null
          balise_signature?: string | null
          campagne_slug?: string
          effectue_le?: string | null
          effectue_par?: string | null
          empreinte_engagement?: string
          empreinte_graine?: string | null
          empreinte_participants?: string
          engagement_le?: string
          engagement_message_id?: string | null
          graine?: string | null
          graine_origine?: string
          id?: string
          motif_annulation?: string | null
          nb_gagnants?: number
          nb_participants?: number
          numero?: number
          parametres?: Json
          poids_mode?: string
          publie?: boolean
          publie_le?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "x_campagne_tirages_campagne_slug_fkey"
            columns: ["campagne_slug"]
            referencedRelation: "x_campagnes"
            referencedColumns: ["slug"]
          },
        ]
      }
      x_campagnes: {
        Row: {
          actif: boolean
          collecte_le: string | null
          comptes_organisateurs: string[]
          created_at: string
          debut_le: string | null
          description: string | null
          fin_le: string | null
          hashtags: string[]
          hashtags_affichage: string[]
          hashtags_rattrapage: string[]
          image_affiche: string | null
          image_couverture: string | null
          image_reglement: string | null
          note_affiche: string | null
          principale: boolean
          publiee: boolean
          reglement: string[]
          relais_depuis: string | null
          relais_salon: string | null
          requetes: string[]
          salons_depot: string[]
          slug: string
          sur_titre: string | null
          titre: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          collecte_le?: string | null
          comptes_organisateurs?: string[]
          created_at?: string
          debut_le?: string | null
          description?: string | null
          fin_le?: string | null
          hashtags: string[]
          hashtags_affichage?: string[]
          hashtags_rattrapage?: string[]
          image_affiche?: string | null
          image_couverture?: string | null
          image_reglement?: string | null
          note_affiche?: string | null
          principale?: boolean
          publiee?: boolean
          reglement?: string[]
          relais_depuis?: string | null
          relais_salon?: string | null
          requetes?: string[]
          salons_depot?: string[]
          slug: string
          sur_titre?: string | null
          titre: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          collecte_le?: string | null
          comptes_organisateurs?: string[]
          created_at?: string
          debut_le?: string | null
          description?: string | null
          fin_le?: string | null
          hashtags?: string[]
          hashtags_affichage?: string[]
          hashtags_rattrapage?: string[]
          image_affiche?: string | null
          image_couverture?: string | null
          image_reglement?: string | null
          note_affiche?: string | null
          principale?: boolean
          publiee?: boolean
          reglement?: string[]
          relais_depuis?: string | null
          relais_salon?: string | null
          requetes?: string[]
          salons_depot?: string[]
          slug?: string
          sur_titre?: string | null
          titre?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      content_feed: {
        Row: {
          author_id: string | null
          category: string | null
          created_at: string | null
          date: string | null
          excerpt: string | null
          id: string | null
          image: string | null
          slug: string | null
          title: string | null
          type: string | null
        }
        Relationships: []
      }
      inagle_awakenings_clean: {
        Row: {
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          id: string | null
          image_url: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          sheet_data: Json | null
          type: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      inagle_keshins_clean: {
        Row: {
          asset_code: string | null
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          element_id: number | null
          id: string | null
          image_url: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          sheet_data: Json | null
          sub_type: string | null
          type: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      inagle_miximax_clean: {
        Row: {
          asset_code: string | null
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          element_id: number | null
          icon_code: string | null
          id: string | null
          image_url: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          sheet_data: Json | null
          sub_type: string | null
          type: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      inagle_mode_changes_clean: {
        Row: {
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          id: string | null
          image_url: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          type: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      inagle_souls_clean: {
        Row: {
          data: Json | null
          description_en: string | null
          description_fr: string | null
          description_ja: string | null
          id: string | null
          image_url: string | null
          name_en: string | null
          name_fr: string | null
          name_ja: string | null
          sheet_data: Json | null
          type: string | null
          updated_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      binary_quantize: {
        Args: { "": string } | { "": unknown }
        Returns: unknown
      }
      check_rate_limit: {
        Args: {
          p_user_id: string
          p_max_count?: number
          p_window_minutes?: number
          p_action: string
        }
        Returns: boolean
      }
      generate_article_slug: {
        Args: { title: string }
        Returns: string
      }
      get_comment_counts: {
        Args: { article_ids: string[] }
        Returns: {
          count: number
          article_id: string
        }[]
      }
      get_my_patreon_status: {
        Args: Record<PropertyKey, never>
        Returns: {
          discount_percent: number
          next_charge_date: string
          currently_entitled_cents: number
          tier_titles: string[]
          status: string
          is_free_trial: boolean
          is_active: boolean
          is_gifted: boolean
        }[]
      }
      get_share_counts: {
        Args: { p_article_ids: string[] }
        Returns: {
          by_platform: Json
          total: number
          article_id: string
        }[]
      }
      get_trending_articles: {
        Args: { days_window?: number; result_limit?: number }
        Returns: {
          id: string
          title: string
          slug: string
          excerpt: string
          featured_image_url: string
          category: string
          view_count: number
          published_at: string
          trending_score: number
        }[]
      }
      gtrgm_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gtrgm_decompress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gtrgm_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gtrgm_options: {
        Args: { "": unknown }
        Returns: undefined
      }
      gtrgm_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      halfvec_avg: {
        Args: { "": number[] }
        Returns: unknown
      }
      halfvec_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      halfvec_send: {
        Args: { "": unknown }
        Returns: string
      }
      halfvec_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
      hnsw_bit_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnsw_halfvec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnsw_sparsevec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnswhandler: {
        Args: { "": unknown }
        Returns: unknown
      }
      increment_article_views: {
        Args: { article_id: string }
        Returns: undefined
      }
      increment_share_count: {
        Args: { p_platform: string; p_article_id: string }
        Returns: undefined
      }
      is_active_patron: {
        Args: { uid: string }
        Returns: boolean
      }
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      ivfflat_bit_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      ivfflat_halfvec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      ivfflathandler: {
        Args: { "": unknown }
        Returns: unknown
      }
      l2_norm: {
        Args: { "": unknown } | { "": unknown }
        Returns: number
      }
      l2_normalize: {
        Args: { "": string } | { "": unknown } | { "": unknown }
        Returns: string
      }
      patreon_heartbeat: {
        Args: { p_success: boolean; p_event_id: string; p_trigger: string }
        Returns: undefined
      }
      rg_libelle_equipe: {
        Args: { id_equipe: string }
        Returns: string
      }
      rg_liberer_profil_discord: {
        Args: { p_discord_id: string }
        Returns: number
      }
      rg_precreer_profils_discord: {
        Args: Record<PropertyKey, never>
        Returns: {
          crees: number
          mis_a_jour: number
        }[]
      }
      rg_uuid_membre_discord: {
        Args: { p_discord_id: string }
        Returns: string
      }
      set_limit: {
        Args: { "": number }
        Returns: number
      }
      show_limit: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      show_trgm: {
        Args: { "": string }
        Returns: string[]
      }
      sparsevec_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      sparsevec_send: {
        Args: { "": unknown }
        Returns: string
      }
      sparsevec_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
      upsert_reading_progress: {
        Args: { p_article_id: string; p_user_id: string; p_progress: number }
        Returns: undefined
      }
      vector_avg: {
        Args: { "": number[] }
        Returns: string
      }
      vector_dims: {
        Args: { "": string } | { "": unknown }
        Returns: number
      }
      vector_norm: {
        Args: { "": string }
        Returns: number
      }
      vector_out: {
        Args: { "": string }
        Returns: unknown
      }
      vector_send: {
        Args: { "": string }
        Returns: string
      }
      vector_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
      x_creation_doublon_ecarte: {
        Args: { p_campagne: string; p_source: string; p_identifiant: string }
        Returns: boolean
      }
      x_masquer_hashtags: {
        Args: { tags: string[]; texte: string }
        Returns: string
      }
      x_regles_non_vides: {
        Args: { regles: string[] }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
