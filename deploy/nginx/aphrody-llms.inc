# SPDX-License-Identifier: Apache-2.0
#
# Les documents destines aux agents, sur TOUS les hotes d'`aphrody.com`.
#
# Pourquoi un include, et pas des fichiers
# ----------------------------------------
# Le meme corpus vivait en **27 fichiers statiques** recopies a la main dans trois
# applications (`llm.txt`, `llms.txt`, `llms-full.txt`, et leurs variantes `.md` et `.html`).
# Vingt-sept copies d'un document qui decrit un site derivent : mesure du 2026-09-07, elles
# annoncaient encore des pages retirees et des hotes qui ne servent plus rien.
#
# `nie-site` les ENGENDRE — depuis les routes qu'il monte reellement, avec l'origine qui lui
# est passee au demarrage, sans rien coder en dur. Un seul generateur, expose ici sur chaque
# hote : le document ne peut plus contredire le site, parce qu'il en est tire.
#
# `Host` n'est PAS transmis : le document doit citer l'origine canonique du site, pas l'hote
# par lequel on l'a demande. Un `llms.txt` servi depuis `cdn.` qui se decrirait comme etant
# `cdn.` enverrait les agents chercher des pages sur un hote qui n'en sert aucune.

location = /llms.txt {
    proxy_pass http://127.0.0.1:8085/llms.txt;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    access_log off;
    add_header X-Robots-Tag "noindex, nofollow" always;
}

location = /llms-full.txt {
    proxy_pass http://127.0.0.1:8085/llms-full.txt;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    access_log off;
    add_header X-Robots-Tag "noindex, nofollow" always;
}

# `llm.txt` au singulier : la forme que portaient les anciens fichiers. Un 301 plutot qu'une
# seconde copie — deux URL pour un document, c'est deja comme ca que les vingt-sept sont nees.
location = /llm.txt { return 301 /llms.txt; }
