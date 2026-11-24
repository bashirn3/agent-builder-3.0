export function BlankPage({ title }: { title: string }) {
  return (
    <div className="k1-page">
      <header className="k1-page__head">
        <h1 className="k1-page-title">{title}</h1>
      </header>
    </div>
  )
}
