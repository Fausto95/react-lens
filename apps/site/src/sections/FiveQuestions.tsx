const QUESTIONS = [
  "What is this element?",
  "Why did it render?",
  "Why is it slow?",
  "What changed?",
  "How do I fix it?",
];

export function FiveQuestions() {
  return (
    <section id="questions">
      <div className="sec-kicker"><span className="dot" /> Five questions, fast</div>
      <h2>Answers, not just numbers.</h2>
      <p className="sec-lead">
        React Lens is built to answer the questions you actually ask while debugging —
        each backed by the real event log, not a guess.
      </p>
      <div className="questions">
        {QUESTIONS.map((q, i) => (
          <div className="q" key={i}>
            <span className="n">{String(i + 1).padStart(2, "0")}</span>
            <span className="t">{q}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
