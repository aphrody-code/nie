# SPDX-License-Identifier: Apache-2.0
#
# Le CONTRAT DE CHEMINS des assets du jeu, pour `cdn.aphrody.com`.
#
# Pourquoi ce fichier existe
# --------------------------
# Les assets du jeu sont servis depuis `cdn.rosegriffon.fr` — un hote **Rose Griffon** pour des
# fichiers qui appartiennent a `aphrody-dev`. La migration demandee le 2026-09-07 n'est PAS un
# renommage d'URL : ce vhost-la fait des reecritures (`/dx11/<x>.png` -> `/tex/dx11/<x>.png`),
# sert d'abord un dump Steam sur disque, et ne tombe sur le decodeur live qu'en repli. Un simple
# `proxy_pass` vers `:8790` rendrait **404** sur `/dx11/`, `/model/` et `/model-full/`, c'est-a-
# dire sur des milliers d'images du wiki.
#
# Ce fichier donne donc a `cdn.aphrody.com` le MEME contrat, chemin pour chemin. Tant que les
# deux hotes rendent la meme chose, basculer les URL du code devient un remplacement de chaine
# sans risque — et jusque-la, rien n'est casse.
#
# `cdn.rosegriffon.fr` n'est PAS touche : les URL deja stockees en base et deja mises en cache
# par les navigateurs continuent de repondre. Deux hotes qui servent la meme chose, le temps
# que les references migrent.
#
# Les upstreams `nie_model_serve` et `cdn_variants` sont declares au niveau `http` par
# `conf.d/cdn.rosegriffon.conf` : ils sont visibles ici sans etre redeclares. Les redeclarer
# ferait un conflit de nom, pas un doublon inoffensif.

# --- Les textures du jeu -----------------------------------------------------------------
location ^~ /dx11/ {
    # Vignette redimensionnee quand `?w=` est present : le service :8805 lit la source et
    # cache le webp. Sans `?w=`, le service direct ci-dessous reste inchange.
    if ($arg_w) {
        proxy_pass http://cdn_variants;
        break;
    }

    alias /home/ubuntu/.local/share/Steam/iecode/inazuma/data/dx11/;

    # Immuable : le contenu est indexe par le buildid Steam, il ne change pas sous la meme URL.
    expires off;
    etag off;
    add_header Cache-Control               "public, immutable, max-age=31536000" always;
    add_header Access-Control-Allow-Origin "*"                                   always;
    add_header X-Robots-Tag                "noindex, nofollow"                   always;

    access_log off;
    # Le dump disque d'abord, le decodeur live seulement s'il manque.
    try_files $uri @decodage_live;

    # `types {}` REMPLACE la table globale : on ne liste que ce qui est servi ici.
    types {
        image/webp                  webp;
        image/avif                  avif;
        image/png                   png;
        image/jpeg                  jpg jpeg;
        image/x-dds                 dds;
        application/vnd.level5.g4tx g4tx;
        application/octet-stream    bin;
    }
}

# --- Les modeles exportes ----------------------------------------------------------------
location ^~ /model/ {
    alias /home/ubuntu/.local/share/Steam/iecode/inazuma/data/dx11/model/;

    expires off;
    etag off;
    add_header Cache-Control               "public, immutable, max-age=31536000" always;
    add_header Access-Control-Allow-Origin "*"                                   always;
    add_header X-Robots-Tag                "noindex, nofollow"                   always;

    access_log off;
    try_files $uri @decodage_live;

    types {
        model/gltf-binary glb;
        model/gltf+json   gltf;
    }
}

# --- Les modeles assembles ---------------------------------------------------------------
location ^~ /model-full/ {
    # Le cache disque d'abord : un assemblage coute plusieurs secondes, le relire coute un
    # `open()`.
    alias /home/ubuntu/niers/var/model-cache/;

    expires off;
    etag off;
    add_header Cache-Control               "public, immutable, max-age=31536000" always;
    add_header Access-Control-Allow-Origin "*"                                   always;
    add_header X-Robots-Tag                "noindex, nofollow"                   always;

    access_log off;
    try_files $uri @assemblage_live;

    types { model/gltf-binary glb; }
}

# --- Les modeles de personnages, toujours assembles a la demande -------------------------
location ^~ /model-chr/ {
    proxy_pass         http://nie_model_serve$request_uri;
    proxy_http_version 1.1;
    proxy_set_header   Host       $host;
    proxy_set_header   Connection "";
    proxy_read_timeout 30s;
    proxy_send_timeout 30s;
    access_log off;
    add_header Access-Control-Allow-Origin "*"                 always;
    add_header X-Robots-Tag                "noindex, nofollow" always;
}

# --- Les replis --------------------------------------------------------------------------
# Une `location` nommee ne se partage pas entre `server` : ces deux-la sont les jumelles de
# celles de `cdn.rosegriffon.fr`, et doivent le rester.
location @decodage_live {
    # `/dx11/<x>.png` est `/tex/dx11/<x>.png` cote service. C'est CETTE reecriture qu'un
    # `proxy_pass` nu oublie, et son oubli rend 404 sur tout ce qui n'est pas dans le dump.
    rewrite ^/(dx11/.+)\.png$ /tex/$1.png break;
    proxy_pass         http://nie_model_serve;
    proxy_http_version 1.1;
    proxy_set_header   Host       $host;
    proxy_set_header   Connection "";
    proxy_read_timeout 30s;
    # Le service n'emet ni CORS ni cache : ils sont poses ici, apres avoir retire les siens.
    proxy_hide_header  Access-Control-Allow-Origin;
    add_header Access-Control-Allow-Origin "*"                                   always;
    add_header Cache-Control               "public, immutable, max-age=31536000" always;
    add_header X-Robots-Tag                "noindex, nofollow"                   always;
}

location @assemblage_live {
    proxy_pass         http://nie_model_serve$request_uri;
    proxy_http_version 1.1;
    proxy_set_header   Host       $host;
    proxy_set_header   Connection "";
    proxy_read_timeout 30s;
    proxy_send_timeout 30s;
    proxy_hide_header  Access-Control-Allow-Origin;
    proxy_hide_header  Cache-Control;
    add_header Access-Control-Allow-Origin "*"                                   always;
    add_header Cache-Control               "public, immutable, max-age=31536000" always;
    add_header X-Robots-Tag                "noindex, nofollow"                   always;
}
