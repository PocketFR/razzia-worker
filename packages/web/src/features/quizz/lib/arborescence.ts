// Le déplacement d'un bloc d'un conteneur à l'autre, hors de React.
//
// C'est la seule opération de l'éditeur qui touche aux deux niveaux à la fois,
// donc la seule qu'on ne puisse pas relire d'un coup d'œil. Isolée ici, elle
// se teste sans navigateur (scripts/test-arborescence.mts) — ce qui, pour un
// panneau que je ne peux pas cliquer, vaut mieux qu'une relecture attentive.
//
// Le module ne connaît ni les types du quiz ni ceux de l'éditeur : il reçoit
// le prédicat qui distingue un groupe d'une question, et rend le tableau
// remanié. Rien à réimporter, rien à réimplémenter dans le test.

interface Destination {
  // Le bloc déplacé.
  id: string
  // Le groupe d'arrivée, ou null pour le premier niveau.
  groupe: string | null
  // Son rang dans le conteneur d'arrivée, tel que lu AVANT l'extraction.
  rang: number
}

export const deplacerBloc = <B extends { id: string }>(
  blocs: B[],
  estGroupe: (_bloc: B) => _bloc is B & { questions: B[] },
  vers: Destination,
): B[] => {
  const auSommet = blocs.find((bloc) => bloc.id === vers.id)

  // Un groupe ne va que dans le sommet, jamais dans un autre groupe.
  if (auSommet && estGroupe(auSommet) && vers.groupe !== null) {
    return blocs
  }

  // On extrait d'abord, on insère ensuite : sans quoi le rang de destination
  // se décalerait quand la source précède la cible dans le même conteneur.
  let bouge: B | null = auSommet ?? null

  const sans = auSommet
    ? blocs.filter((bloc) => bloc.id !== vers.id)
    : blocs.map((bloc) => {
        if (!estGroupe(bloc)) {
          return bloc
        }

        const trouve = bloc.questions.find(
          (question) => question.id === vers.id,
        )

        if (trouve) {
          bouge = trouve
        }

        return {
          ...bloc,
          questions: bloc.questions.filter(
            (question) => question.id !== vers.id,
          ),
        }
      })

  if (!bouge) {
    return blocs
  }

  const insere: B = bouge

  const remanie =
    vers.groupe === null
      ? [...sans.slice(0, vers.rang), insere, ...sans.slice(vers.rang)]
      : sans.map((bloc) => {
          if (!estGroupe(bloc) || bloc.id !== vers.groupe) {
            return bloc
          }

          const dedans = [...bloc.questions]
          dedans.splice(vers.rang, 0, insere)

          return { ...bloc, questions: dedans }
        })

  // Un groupe vidé par le départ de sa dernière question disparaît, comme à la
  // suppression : il serait de toute façon refusé à l'enregistrement.
  return remanie.filter((bloc) => !estGroupe(bloc) || bloc.questions.length > 0)
}
