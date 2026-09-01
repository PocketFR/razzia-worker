import { defineConfig } from "oxlint"

export default defineConfig({
  env: {
    browser: true,
    builtin: true,
    node: true,
  },

  // Les globales du runtime Workers, qu'aucun des environnements ci-dessus ne
  // déclare. TypeScript les connaît par @cloudflare/workers-types ; le linter,
  // lui, ne lit pas les types pour cela.
  globals: {
    DurableObject: "readonly",
    DurableObjectNamespace: "readonly",
    DurableObjectState: "readonly",
    ScheduledController: "readonly",
    WebSocketPair: "readonly",
  },
  jsPlugins: ["@stylistic/eslint-plugin"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  plugins: ["typescript"],
  // Les scripts de vérification ne sont pas du code livré : ce sont des outils
  // qui parlent à un serveur en HTTP et en WebSocket, écrits en JavaScript nu
  // et exécutés à la main. Les règles typées de TypeScript n'y ont aucune
  // information à se mettre sous la dent — tout y est « error typed value » —
  // et produisaient à elles seules plus de mille signalements qui ne
  // désignaient rien.
  ignorePatterns: [
    "packages/worker/scripts/**",
    // Packages/socket est le serveur Node de l'amont, figé au point de fork.
    // Il n'est plus construit ni déployé — le Worker ne lui emprunte que
    // QUESTION_SCORING — et il ne compile plus contre les types partagés que
    // le portage a étendus : ManagerConfig a gagné des champs, les statuts un
    // `endsAt`. Le linter les signale à juste titre ; les corriger reviendrait
    // à faire diverger le seul fichier qu'on garde justement identique à
    // l'amont pour pouvoir en reprendre les correctifs.
    "packages/socket/**",
  ],

  overrides: [
    {
      // Le paquet worker commente en blocs, et c'est délibéré : ses
      // en-têtes expliquent des décisions sur vingt lignes, ce que
      // « separate-lines » transformerait en murs de //. La règle reste en
      // vigueur sur le code hérité de l'amont, dont ce n'est pas le style.
      files: ["packages/worker/**/*.ts"],
      rules: {
        "@stylistic/multiline-comment-style": "off",
      },
    },
    {
      // Ces fichiers lisent du JSON d'API tierces — Spotify, Deezer,
      // Mistral, OpenTDB — dont la forme n'est garantie par personne. Le
      // `any` y est assumé et documenté : chaque champ passe par `champ()`,
      // par un adaptateur, ou par une validation explicite avant d'être
      // utilisé. Les règles no-unsafe-* y signalent la nature du problème,
      // pas un défaut.
      //
      // Le dossier musique/ a rejoint la liste en même temps que Deezer :
      // c'est le client Spotify de quizia qui y a déménagé, mot pour mot, le
      // temps de lui donner un jumeau. Le code n'a pas changé de nature en
      // changeant de fichier.
      files: [
        "packages/worker/src/quizia/core.ts",
        "packages/worker/src/musique/*.ts",
      ],
      rules: {
        "typescript/no-explicit-any": "off",
        // `||` et non `??`, et c'est délibéré sur les 45 sites que la règle
        // signale ici. Sur du JSON tiers, une chaîne vide est aussi
        // inexploitable qu'un champ absent, et `??` la laisserait passer :
        //
        //   JSON.parse(content ?? "{}")   plante sur ""
        //   parseInt(entete ?? "2")       rend NaN sur ""
        //   `year:${anneeMin ?? 1900}`    accepte l'an 0
        //
        // La règle a raison en général, et tort exactement là où les données
        // ne sont garanties par personne.
        "typescript/prefer-nullish-coalescing": "off",
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-return": "off",
        // Même famille, même raison : ces règles constatent que le JSON de
        // Spotify, Mistral et OpenTDB n'est typé par personne. C'est exact,
        // et c'est précisément ce que `champ()` et les validations explicites
        // de ce fichier prennent en charge.
        "typescript/no-base-to-string": "off",
        "typescript/prefer-optional-chain": "off",
        "typescript/restrict-plus-operands": "off",
        "typescript/restrict-template-expressions": "off",
        "typescript/unbound-method": "off",
        // Les fonctions de ce fichier prennent des paramètres positionnels du
        // même plan — base, clés, titre, questions, pistes. Un objet
        // d'options les rendrait plus verbeuses à appeler qu'à lire.
        "max-params": "off",
      },
    },
    {
      files: ["packages/web/**/*.{ts,tsx}"],
      plugins: ["react"],
      rules: {
        "react/jsx-key": "off",
      },
    },
  ],
  rules: {
    "@stylistic/line-comment-position": ["error", { position: "above" }],
    "@stylistic/linebreak-style": ["error", "unix"],
    "@stylistic/multiline-comment-style": ["error", "separate-lines"],
    "@stylistic/padded-blocks": ["error", "never"],
    "@stylistic/padding-line-between-statements": [
      "error",
      {
        blankLine: "always",
        next: [
          "break",
          "case",
          "cjs-export",
          "class",
          "continue",
          "do",
          "export",
          "if",
          "switch",
          "try",
          "while",
          "return",
        ],
        prev: "*",
      },
      {
        blankLine: "always",
        next: "*",
        prev: [
          "break",
          "case",
          "cjs-export",
          "class",
          "continue",
          "do",
          "export",
          "if",
          "return",
          "switch",
          "try",
          "while",
        ],
      },
    ],
    "@stylistic/quotes": [
      "error",
      "double",
      { allowTemplateLiterals: "always", avoidEscape: true },
    ],
    "@stylistic/semi": ["error", "never"],
    "@stylistic/space-before-blocks": "error",
    "@stylistic/wrap-iife": ["error", "inside"],
    "array-callback-return": [
      "error",
      { allowImplicit: false, allowVoid: true, checkForEach: true },
    ],
    "arrow-body-style": ["error", "as-needed"],
    "capitalized-comments": [
      "error",
      "always",
      { ignoreConsecutiveComments: true },
    ],
    "class-methods-use-this": ["error", { enforceForClassFields: true }],
    "constructor-super": "error",
    curly: ["error", "all"],
    "default-param-last": "error",
    eqeqeq: ["error", "always"],
    "for-direction": "error",
    "func-names": "error",
    "func-style": ["error", "declaration", { allowArrowFunctions: true }],
    "getter-return": "error",
    "grouped-accessor-pairs": ["error", "getBeforeSet"],
    "guard-for-in": "error",
    "init-declarations": ["error", "always"],
    "max-classes-per-file": ["error", { ignoreExpressions: true }],
    "max-nested-callbacks": ["error", 3],
    // Quatre plutôt que trois. Les fonctions concernées prennent une base, un
    // nom, un type et un contenu — des paramètres du même plan, qu'un objet
    // d'options rendrait plus verbeux à appeler qu'à lire.
    "max-params": ["error", 4],
    "new-cap": "error",
    "no-alert": "error",
    "no-async-promise-executor": "error",
    "no-await-in-loop": "error",
    "no-caller": "error",
    "no-case-declarations": "error",
    "no-class-assign": "error",
    "no-compare-neg-zero": "error",
    "no-cond-assign": "error",
    "no-console": "off",
    "no-const-assign": "error",
    "no-constant-binary-expression": "error",
    "no-constant-condition": "error",
    "no-constructor-return": "error",
    "no-control-regex": "error",
    "no-debugger": "error",
    "no-delete-var": "error",
    "no-dupe-class-members": "error",
    "no-dupe-else-if": "error",
    "no-dupe-keys": "error",
    "no-duplicate-case": "error",
    "no-duplicate-imports": ["error", { includeExports: true }],
    "no-else-return": "error",
    "no-empty": "error",
    "no-empty-character-class": "error",
    "no-empty-function": "error",
    "no-empty-pattern": "error",
    "no-empty-static-block": "error",
    "no-eq-null": "error",
    "no-eval": "error",
    "no-ex-assign": "error",
    "no-extend-native": "error",
    "no-extra-boolean-cast": "error",
    "no-extra-label": "error",
    "no-fallthrough": "error",
    "no-func-assign": "error",
    "no-global-assign": "error",
    "no-implicit-coercion": "error",
    "no-import-assign": "error",
    "no-inline-comments": "error",
    "no-invalid-regexp": "error",
    "no-irregular-whitespace": "error",
    "no-iterator": "error",
    "no-labels": "error",
    "no-lone-blocks": "error",
    "no-lonely-if": "error",
    "no-loop-func": "error",
    "no-loss-of-precision": "error",
    "no-misleading-character-class": "error",
    "no-multi-assign": "error",
    "no-multi-str": "error",
    "no-nested-ternary": "off",
    "no-new": "error",
    "no-new-func": "error",
    "no-new-native-nonconstructor": "error",
    "no-new-wrappers": "error",
    "no-nonoctal-decimal-escape": "error",
    "no-obj-calls": "error",
    "no-object-constructor": "error",
    "no-param-reassign": "error",
    "no-plusplus": "error",
    "no-promise-executor-return": ["error", { allowVoid: true }],
    "no-proto": "error",
    "no-prototype-builtins": "error",
    "no-redeclare": "error",
    "no-regex-spaces": "error",
    "no-return-assign": ["error", "always"],
    "no-script-url": "error",
    "no-self-assign": "error",
    "no-self-compare": "error",
    "no-sequences": "error",
    "no-setter-return": "error",
    "no-shadow": "error",
    "no-shadow-restricted-names": "error",
    "no-sparse-arrays": "error",
    "no-template-curly-in-string": "error",
    "no-this-before-super": "error",
    "no-throw-literal": "error",
    "no-undef": "error",
    "no-undefined": "off",
    "no-unexpected-multiline": "error",
    "no-unmodified-loop-condition": "error",
    "no-unneeded-ternary": ["error", { defaultAssignment: false }],
    "no-unreachable": "error",
    "no-unsafe-finally": "error",
    "no-unsafe-negation": "error",
    "no-unsafe-optional-chaining": "error",
    "no-unused-expressions": ["error", { enforceForJSX: true }],
    "no-unused-labels": "error",
    "no-unused-private-class-members": "error",
    "no-useless-backreference": "error",
    "no-useless-call": "error",
    "no-useless-catch": "error",
    "no-useless-computed-key": ["error", { enforceForClassMembers: true }],
    "no-useless-concat": "error",
    "no-useless-constructor": "error",
    "no-useless-escape": "error",
    "no-useless-rename": "error",
    "no-useless-return": "off",
    "no-var": "error",
    "no-warning-comments": ["error", { terms: ["todo"] }],
    "no-with": "error",
    "object-shorthand": ["error", "always"],
    "operator-assignment": ["error", "always"],
    "prefer-const": [
      "error",
      { destructuring: "any", ignoreReadBeforeAssign: false },
    ],
    "prefer-destructuring": "error",
    "prefer-exponentiation-operator": "error",
    "prefer-numeric-literals": "error",
    "prefer-object-has-own": "error",
    "prefer-object-spread": "error",
    "prefer-promise-reject-errors": "error",
    "prefer-rest-params": "error",
    "prefer-spread": "error",
    "prefer-template": "error",
    radix: "error",
    "require-await": "off",
    "require-yield": "error",
    "symbol-description": "error",
    "typescript/adjacent-overload-signatures": "error",
    "typescript/array-type": [
      "error",
      { default: "array-simple", readonly: "array-simple" },
    ],
    "typescript/await-thenable": "error",
    "typescript/ban-ts-comment": ["error", { minimumDescriptionLength: 10 }],
    "typescript/ban-tslint-comment": "error",
    "typescript/class-literal-property-style": "error",
    "typescript/consistent-generic-constructors": "error",
    "typescript/consistent-indexed-object-style": "error",
    "typescript/consistent-type-assertions": "error",
    "typescript/consistent-type-definitions": "error",
    "typescript/dot-notation": "error",
    "typescript/no-array-delete": "error",
    "typescript/no-base-to-string": "error",
    "typescript/no-confusing-non-null-assertion": "error",
    "typescript/no-confusing-void-expression": "off",
    "typescript/no-deprecated": "error",
    "typescript/no-duplicate-enum-values": "error",
    "typescript/no-duplicate-type-constituents": "error",
    "typescript/no-dynamic-delete": "error",
    "typescript/no-empty-object-type": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-extra-non-null-assertion": "error",
    "typescript/no-extraneous-class": "error",
    "typescript/no-floating-promises": "off",
    "typescript/no-for-in-array": "error",
    "typescript/no-implied-eval": "error",
    "typescript/no-inferrable-types": "error",
    "typescript/no-invalid-void-type": "error",
    "typescript/no-meaningless-void-operator": "error",
    "typescript/no-misused-new": "error",
    "typescript/no-misused-promises": [
      "error",
      { checksVoidReturn: { attributes: false } },
    ],
    "typescript/no-misused-spread": "error",
    "typescript/no-mixed-enums": "error",
    "typescript/no-namespace": "error",
    "typescript/no-non-null-asserted-nullish-coalescing": "error",
    "typescript/no-non-null-asserted-optional-chain": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/no-redundant-type-constituents": "error",
    "typescript/no-require-imports": "error",
    "typescript/no-this-alias": "error",
    "typescript/no-unnecessary-boolean-literal-compare": "error",
    // DÉSACTIVÉE APRÈS EXAMEN DES VINGT-TROIS SIGNALEMENTS, dont aucun ne
    // désignait un raisonnement mort. Cette règle raisonne sur les types ; or
    // ici les types décrivent une INTENTION aux frontières de confiance, pas
    // une garantie d'exécution. Quatre cas où la suivre ferait planter :
    //
    //   classes[index - 1]      undefined pour le premier du classement, mais
    //                           noUncheckedIndexedAccess n'est pas activé ;
    //   crypto.subtle           déclaré toujours présent, absent hors HTTPS —
    //                           le garde-fou existe précisément pour ça ;
    //   requestFullscreen       déclaré toujours présent, absent sur Safari
    //                           iOS, d'où le repli webkit juste à côté ;
    //   compteurEnvoyeA         absent d'une salle persistée avant que le
    //                           champ n'existe.
    //
    // S'y ajoutent les trames JSON du réseau et les groupes de capture, dont
    // le type vient d'une assertion et non d'une vérification.
    "typescript/no-unnecessary-condition": "off",

    // DÉSACTIVÉE : elle réclamerait « let data: unknown = undefined » devant
    // chaque bloc try. Les quatorze sites suivent tous le même motif — on
    // déclare, on tente une analyse de données non fiables, on rattrape. Une
    // initialisation explicite à undefined n'y apprend rien à personne.
    "eslint/init-declarations": "off",

    // DÉSACTIVÉE POUR LES COMPTEURS DE BOUCLE, après avoir corrigé les trois
    // sites où la règle avait raison : « seq: ++etat.seq » mutait l'état à
    // l'intérieur d'un littéral d'objet, ce qui cache un effet de bord là où
    // personne ne le cherche. L'incrément est désormais une instruction à
    // part. Reste huit « for (…; i++) », où i += 1 n'apporte rien.
    "eslint/no-plusplus": "off",

    // DÉSACTIVÉE : ici l'attente dans une boucle EST le mécanisme. Les cinq
    // sites sont des mises en série voulues — le découpage en lots qui tient
    // la limite de six connexions sortantes de Cloudflare, la résolution des
    // morceaux qui ménage l'API Spotify, la reprise du PIN qui doit constater
    // un échec avant de retenter. Les paralléliser casserait ce que la règle
    // croit améliorer.
    "eslint/no-await-in-loop": "off",

    // DÉSACTIVÉE : le Durable Object a des méthodes privées qui n'utilisent
    // pas `this` — construire une trame, comparer deux échéances. Les sortir
    // de la classe les éloignerait de ce qu'elles servent sans rien y gagner.
    "eslint/class-methods-use-this": "off",

    "typescript/no-unnecessary-template-expression": "error",
    "typescript/no-unnecessary-type-arguments": "error",
    "typescript/no-unnecessary-type-assertion": "error",
    "typescript/no-unnecessary-type-constraint": "error",
    "typescript/no-unnecessary-type-conversion": "error",
    "typescript/no-unnecessary-type-parameters": "error",
    "typescript/no-unsafe-argument": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-declaration-merging": "error",
    "typescript/no-unsafe-enum-comparison": "error",
    "typescript/no-unsafe-function-type": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/no-unsafe-unary-minus": "error",
    "typescript/no-useless-default-assignment": "error",
    "typescript/no-wrapper-object-types": "error",
    "typescript/non-nullable-type-assertion-style": "error",
    "typescript/only-throw-error": "error",
    "typescript/prefer-as-const": "error",
    "typescript/prefer-find": "error",
    "typescript/prefer-for-of": "error",
    "typescript/prefer-function-type": "error",
    "typescript/prefer-includes": "error",
    "typescript/prefer-literal-enum-member": "error",
    "typescript/prefer-namespace-keyword": "error",
    "typescript/prefer-nullish-coalescing": "error",
    "typescript/prefer-optional-chain": "error",
    "typescript/prefer-promise-reject-errors": "error",
    "typescript/prefer-reduce-type-parameter": "error",
    "typescript/prefer-regexp-exec": "error",
    "typescript/prefer-return-this-type": "error",
    "typescript/prefer-string-starts-ends-with": "error",
    "typescript/related-getter-setter-pairs": "error",
    // DÉSACTIVÉE : plusieurs fonctions restent `async` sans attendre, pour
    // tenir une interface commune — les gestionnaires du routeur rendent tous
    // une promesse, et faire l'exception pour ceux qui n'attendent rien
    // obligerait l'appelant à distinguer les deux.
    "typescript/require-await": "off",
    "typescript/restrict-plus-operands": [
      "error",
      {
        allowAny: false,
        allowBoolean: false,
        allowNullish: false,
        allowNumberAndString: false,
        allowRegExp: false,
      },
    ],
    "typescript/restrict-template-expressions": [
      "error",
      { allowBoolean: true, allowNumber: true },
    ],
    "typescript/return-await": ["error", "error-handling-correctness-only"],
    "typescript/triple-slash-reference": "error",
    "typescript/unbound-method": "error",
    "typescript/unified-signatures": "error",
    "typescript/use-unknown-in-catch-callback-variable": "error",
    "use-isnan": "error",
    "valid-typeof": "error",
    yoda: "error",
  },
})
