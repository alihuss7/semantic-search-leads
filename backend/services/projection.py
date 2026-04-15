import numpy as np
from sklearn.manifold import TSNE


def compute_tsne(
    embeddings: np.ndarray,
    perplexity: float = 30.0,
    n_iter: int = 1000,
    random_state: int = 42,
) -> np.ndarray:
    n = len(embeddings)
    # perplexity must be < n_samples
    effective_perplexity = min(perplexity, n - 1)
    tsne = TSNE(
        n_components=2,
        perplexity=effective_perplexity,
        max_iter=n_iter,
        random_state=random_state,
        metric="cosine",
        init="pca",
    )
    return tsne.fit_transform(embeddings)
