/**
 * Definição e agrupamento dos livros bíblicos em 3 categorias principais.
 * Evangelhos (São Mateus, São Marcos, São Lucas, São João) e Atos dos Apóstolos
 * estão EXCLUÍDOS conforme restrição de negócio.
 */

export const CATEGORIES = {
  at_historia: {
    id: "at_historia",
    title: "Antigo Testamento",
    estimated_time: "~2 a 3 min",
    books: [
      "Gênesis", "Êxodo", "Levítico", "Números", "Deuteronômio",
      "Josué", "Juízes", "Rute", "I Samuel", "II Samuel",
      "I Reis", "II Reis", "I Crônicas", "II Crônicas",
      "Esdras", "Neemias", "Tobias", "Judite", "Ester",
      "I Macabeus", "II Macabeus", "Isaías", "Jeremias", "Lamentações",
      "Baruc", "Ezequiel", "Daniel", "Oséias", "Joel",
      "Amós", "Abdias", "Jonas", "Miquéias", "Naum",
      "Habacuc", "Sofonias", "Ageu", "Zacarias", "Malaquias"
    ]
  },
  poesia_sabedoria: {
    id: "poesia_sabedoria",
    title: "Poesia e Sabedoria",
    estimated_time: "~2 a 3 min",
    books: [
      "Jó", "Salmos", "Provérbios", "Eclesiastes",
      "Cântico dos Cânticos", "Sabedoria", "Eclesiástico"
    ]
  },
  cartas_epistolas: {
    id: "cartas_epistolas",
    title: "Cartas e Epístolas",
    estimated_time: "~2 a 3 min",
    books: [
      "Romanos", "I Coríntios", "II Coríntios", "Gálatas",
      "Efésios", "Filipenses", "Colossenses", "I Tessalonicenses",
      "II Tessalonicenses", "I Timóteo", "II Timóteo", "Tito",
      "Filêmon", "Hebreus", "São Tiago", "I São Pedro",
      "II São Pedro", "I São João", "II São João", "III São João",
      "São Judas", "Apocalipse"
    ]
  }
};
