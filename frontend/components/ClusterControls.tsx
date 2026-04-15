"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useCluster } from "@/hooks/useCluster";
import type {
  AutoTuneObjective,
  ClusterAlgorithm,
  ClusterRequest,
  ClusterResponse,
  CovarianceType,
  DistanceMetric,
  LinkageType,
  OutlierPolicy,
} from "@/lib/types";

interface Props {
  onClusterDone: (result: ClusterResponse, algorithm: ClusterAlgorithm) => void;
}

const ALGORITHM_OPTIONS: Array<{ value: ClusterAlgorithm; label: string }> = [
  { value: "kmeans", label: "K-Means" },
  { value: "mini_batch_kmeans", label: "MiniBatch K-Means" },
  { value: "agglomerative", label: "Agglomerative" },
  { value: "dbscan", label: "DBSCAN" },
  { value: "optics", label: "OPTICS" },
  { value: "birch", label: "Birch" },
  { value: "gaussian_mixture", label: "Gaussian Mixture" },
  { value: "hdbscan", label: "HDBSCAN" },
];

const METRIC_OPTIONS_BY_ALGORITHM: Record<ClusterAlgorithm, DistanceMetric[]> = {
  kmeans: ["euclidean"],
  mini_batch_kmeans: ["euclidean"],
  agglomerative: ["euclidean", "manhattan", "cosine"],
  dbscan: ["euclidean", "manhattan", "cosine"],
  optics: ["euclidean", "manhattan", "cosine"],
  birch: ["euclidean"],
  gaussian_mixture: ["euclidean"],
  hdbscan: ["euclidean", "manhattan"],
};

function metricLabel(metric: DistanceMetric): string {
  if (metric === "euclidean") return "Euclidean";
  if (metric === "manhattan") return "Manhattan";
  return "Cosine";
}

function algorithmNeedsNClusters(algorithm: ClusterAlgorithm): boolean {
  return [
    "kmeans",
    "mini_batch_kmeans",
    "agglomerative",
    "birch",
    "gaussian_mixture",
  ].includes(algorithm);
}

function algorithmSupportsOutliers(algorithm: ClusterAlgorithm): boolean {
  return algorithm === "dbscan" || algorithm === "optics" || algorithm === "hdbscan";
}

export default function ClusterControls({ onClusterDone }: Props) {
  const [algorithm, setAlgorithm] = useState<ClusterAlgorithm>("kmeans");
  const [distanceMetric, setDistanceMetric] = useState<DistanceMetric>("euclidean");
  const [outlierPolicy, setOutlierPolicy] = useState<OutlierPolicy>("keep");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isPreprocessingCollapsed, setIsPreprocessingCollapsed] = useState(true);
  const [isReproducibilityCollapsed, setIsReproducibilityCollapsed] = useState(true);

  const [normalizeEmbeddings, setNormalizeEmbeddings] = useState(false);
  const [pcaComponents, setPcaComponents] = useState<string>("");

  const [lockRandomState, setLockRandomState] = useState(true);
  const [randomState, setRandomState] = useState(42);

  const [nClusters, setNClusters] = useState(8);
  const [autoTuneK, setAutoTuneK] = useState(false);
  const [kMin, setKMin] = useState(2);
  const [kMax, setKMax] = useState(12);
  const [autoTuneObjective, setAutoTuneObjective] = useState<AutoTuneObjective>("silhouette");
  const [minClusterSize, setMinClusterSize] = useState(5);
  const [minSamples, setMinSamples] = useState(5);
  const [eps, setEps] = useState(0.35);
  const [maxEps, setMaxEps] = useState(2.0);
  const [linkage, setLinkage] = useState<LinkageType>("average");
  const [covarianceType, setCovarianceType] = useState<CovarianceType>("full");
  const [birchThreshold, setBirchThreshold] = useState(0.5);
  const [birchBranchingFactor, setBirchBranchingFactor] = useState(50);

  const mutation = useCluster();

  const supportedMetrics = useMemo(() => {
    if (algorithm === "agglomerative" && linkage === "ward") {
      return ["euclidean"] as DistanceMetric[];
    }
    return METRIC_OPTIONS_BY_ALGORITHM[algorithm];
  }, [algorithm, linkage]);

  useEffect(() => {
    if (!supportedMetrics.includes(distanceMetric)) {
      setDistanceMetric(supportedMetrics[0]);
    }
  }, [supportedMetrics, distanceMetric]);

  useEffect(() => {
    if (!algorithmNeedsNClusters(algorithm)) {
      setAutoTuneK(false);
    }
  }, [algorithm]);

  async function handleRun() {
    try {
      const parsedPca =
        pcaComponents.trim() === "" ? null : Math.floor(Number(pcaComponents));
      if (parsedPca !== null && (!Number.isFinite(parsedPca) || parsedPca < 2)) {
        toast.error("PCA components must be empty or >= 2");
        return;
      }
      if (autoTuneK && kMax < kMin) {
        toast.error("k_max must be greater than or equal to k_min");
        return;
      }

      const body: ClusterRequest = {
        algorithm,
        distance_metric: distanceMetric,
        outlier_policy: outlierPolicy,
        normalize_embeddings: normalizeEmbeddings,
        pca_components: parsedPca,
        lock_random_state: lockRandomState,
        random_state: randomState,
      };

      if (algorithmNeedsNClusters(algorithm)) {
        body.n_clusters = nClusters;
        body.auto_tune_k = autoTuneK;
        body.k_min = kMin;
        body.k_max = kMax;
        body.auto_tune_objective = autoTuneObjective;
      }
      if (algorithm === "agglomerative") {
        body.linkage = linkage;
      }
      if (algorithm === "dbscan" || algorithm === "optics") {
        body.min_samples = minSamples;
        body.eps = eps;
      }
      if (algorithm === "optics") {
        body.max_eps = maxEps;
      }
      if (algorithm === "hdbscan") {
        body.min_cluster_size = minClusterSize;
        body.min_samples = minSamples;
      }
      if (algorithm === "gaussian_mixture") {
        body.covariance_type = covarianceType;
      }
      if (algorithm === "birch") {
        body.birch_threshold = birchThreshold;
        body.birch_branching_factor = birchBranchingFactor;
      }

      const result = await mutation.mutateAsync(body);
      toast.success(`${ALGORITHM_OPTIONS.find((a) => a.value === algorithm)?.label}: ${result.n_clusters_found} clusters`);
      onClusterDone(result, result.algorithm);
    } catch (e: unknown) {
      toast.error((e as Error).message ?? "Clustering failed");
    }
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-600 uppercase tracking-wider">Clustering</h2>
        <button
          type="button"
          onClick={() => setIsCollapsed((v) => !v)}
          className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700 rounded border border-zinc-200"
        >
          {isCollapsed ? "Show" : "Hide"}
        </button>
      </div>

      {!isCollapsed && (
        <>

      <div className="space-y-1">
        <label className="text-xs text-zinc-500">Algorithm</label>
        <select
          value={algorithm}
          onChange={(e) => setAlgorithm(e.target.value as ClusterAlgorithm)}
          className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
        >
          {ALGORITHM_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-zinc-500">Distance Metric</label>
        <select
          value={distanceMetric}
          onChange={(e) => setDistanceMetric(e.target.value as DistanceMetric)}
          className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
        >
          {supportedMetrics.map((metric) => (
            <option key={metric} value={metric}>
              {metricLabel(metric)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-zinc-500">Outlier Handling</label>
        <select
          value={outlierPolicy}
          onChange={(e) => setOutlierPolicy(e.target.value as OutlierPolicy)}
          className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
        >
          <option value="keep">Keep noise as -1</option>
          <option value="drop">Drop noise points</option>
          <option value="nearest">Assign noise to nearest cluster</option>
        </select>
        {!algorithmSupportsOutliers(algorithm) && (
          <p className="text-[11px] text-zinc-500">Used by DBSCAN, OPTICS, and HDBSCAN when noise labels exist.</p>
        )}
      </div>

      {algorithmNeedsNClusters(algorithm) && (
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">Clusters (k)</label>
          <input
            type="number"
            min={2}
            max={200}
            value={nClusters}
            onChange={(e) => setNClusters(Math.max(2, Math.floor(Number(e.target.value) || 2)))}
            className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
          />
        </div>
      )}

      {algorithmNeedsNClusters(algorithm) && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2 space-y-2">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Auto-Tune K</p>
          <label className="flex items-center justify-between text-xs text-zinc-700">
            <span>Enable auto-tune</span>
            <input
              type="checkbox"
              checked={autoTuneK}
              onChange={(e) => setAutoTuneK(e.target.checked)}
              className="accent-zinc-900"
            />
          </label>
          {autoTuneK && (
            <>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">k_min</label>
                <input
                  type="number"
                  min={2}
                  max={200}
                  value={kMin}
                  onChange={(e) => setKMin(Math.max(2, Math.floor(Number(e.target.value) || 2)))}
                  className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">k_max</label>
                <input
                  type="number"
                  min={2}
                  max={200}
                  value={kMax}
                  onChange={(e) => setKMax(Math.max(2, Math.floor(Number(e.target.value) || 2)))}
                  className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Objective</label>
                <select
                  value={autoTuneObjective}
                  onChange={(e) => setAutoTuneObjective(e.target.value as AutoTuneObjective)}
                  className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
                >
                  <option value="silhouette">silhouette (maximize)</option>
                  <option value="calinski_harabasz">calinski-harabasz (maximize)</option>
                  <option value="davies_bouldin">davies-bouldin (minimize)</option>
                </select>
              </div>
            </>
          )}
        </div>
      )}

      {algorithm === "agglomerative" && (
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">Linkage</label>
          <select
            value={linkage}
            onChange={(e) => setLinkage(e.target.value as LinkageType)}
            className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
          >
            <option value="ward">ward</option>
            <option value="average">average</option>
            <option value="complete">complete</option>
            <option value="single">single</option>
          </select>
          {linkage === "ward" && (
            <p className="text-[11px] text-zinc-500">Ward linkage requires Euclidean distance.</p>
          )}
        </div>
      )}

      {(algorithm === "dbscan" || algorithm === "optics") && (
        <>
          <div className="space-y-1">
            <label className="text-xs text-zinc-500">eps</label>
            <input
              type="number"
              min={0.01}
              max={10}
              step={0.01}
              value={eps}
              onChange={(e) => setEps(Number(e.target.value) || 0.01)}
              className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-zinc-500">min_samples</label>
            <input
              type="number"
              min={1}
              max={1000}
              value={minSamples}
              onChange={(e) => setMinSamples(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
            />
          </div>
        </>
      )}

      {algorithm === "optics" && (
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">max_eps</label>
          <input
            type="number"
            min={0.01}
            max={10}
            step={0.01}
            value={maxEps}
            onChange={(e) => setMaxEps(Number(e.target.value) || 0.01)}
            className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
          />
        </div>
      )}

      {algorithm === "hdbscan" && (
        <>
          <div className="space-y-1">
            <label className="text-xs text-zinc-500">min_cluster_size</label>
            <input
              type="number"
              min={2}
              max={1000}
              value={minClusterSize}
              onChange={(e) => setMinClusterSize(Math.max(2, Math.floor(Number(e.target.value) || 2)))}
              className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-zinc-500">min_samples</label>
            <input
              type="number"
              min={1}
              max={1000}
              value={minSamples}
              onChange={(e) => setMinSamples(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
            />
          </div>
        </>
      )}

      {algorithm === "gaussian_mixture" && (
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">covariance_type</label>
          <select
            value={covarianceType}
            onChange={(e) => setCovarianceType(e.target.value as CovarianceType)}
            className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
          >
            <option value="full">full</option>
            <option value="tied">tied</option>
            <option value="diag">diag</option>
            <option value="spherical">spherical</option>
          </select>
        </div>
      )}

      {algorithm === "birch" && (
        <>
          <div className="space-y-1">
            <label className="text-xs text-zinc-500">threshold</label>
            <input
              type="number"
              min={0.01}
              max={10}
              step={0.01}
              value={birchThreshold}
              onChange={(e) => setBirchThreshold(Number(e.target.value) || 0.01)}
              className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-zinc-500">branching_factor</label>
            <input
              type="number"
              min={2}
              max={500}
              value={birchBranchingFactor}
              onChange={(e) => setBirchBranchingFactor(Math.max(2, Math.floor(Number(e.target.value) || 2)))}
              className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
            />
          </div>
        </>
      )}

      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Preprocessing</p>
          <button
            type="button"
            onClick={() => setIsPreprocessingCollapsed((v) => !v)}
            className="px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-700 rounded border border-zinc-200 bg-white"
          >
            {isPreprocessingCollapsed ? "Show" : "Hide"}
          </button>
        </div>
        {!isPreprocessingCollapsed && (
          <div className="mt-2 space-y-2">
            <label className="flex items-center justify-between text-xs text-zinc-700">
              <span>Normalize embeddings</span>
              <input
                type="checkbox"
                checked={normalizeEmbeddings}
                onChange={(e) => setNormalizeEmbeddings(e.target.checked)}
                className="accent-zinc-900"
              />
            </label>
            <div className="space-y-1">
              <label className="text-xs text-zinc-500">PCA components (optional)</label>
              <input
                type="number"
                min={2}
                max={768}
                placeholder="None"
                value={pcaComponents}
                onChange={(e) => setPcaComponents(e.target.value)}
                className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
              />
            </div>
          </div>
        )}
      </div>

      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Reproducibility</p>
          <button
            type="button"
            onClick={() => setIsReproducibilityCollapsed((v) => !v)}
            className="px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-700 rounded border border-zinc-200 bg-white"
          >
            {isReproducibilityCollapsed ? "Show" : "Hide"}
          </button>
        </div>
        {!isReproducibilityCollapsed && (
          <div className="mt-2 space-y-2">
            <label className="flex items-center justify-between text-xs text-zinc-700">
              <span>Lock random seed</span>
              <input
                type="checkbox"
                checked={lockRandomState}
                onChange={(e) => setLockRandomState(e.target.checked)}
                className="accent-zinc-900"
              />
            </label>
            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Random seed</label>
              <input
                type="number"
                min={0}
                max={2147483647}
                value={randomState}
                onChange={(e) => setRandomState(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="w-full rounded-md bg-white border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-500"
              />
            </div>
          </div>
        )}
      </div>

      <button
        onClick={handleRun}
        disabled={mutation.isPending}
        className="w-full py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white transition-colors"
      >
        {mutation.isPending ? "Running…" : "Run Clustering"}
      </button>

      {mutation.data && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700 space-y-1">
          <p className="text-zinc-700">
            {mutation.data.n_clusters_found} clusters
            {mutation.data.noise_points > 0 ? ` · ${mutation.data.noise_points} noise` : ""}
          </p>
          <p className="text-zinc-500">
            metric: {metricLabel(mutation.data.distance_metric)}
            {mutation.data.pca_components ? ` · PCA ${mutation.data.pca_components}` : ""}
            {mutation.data.normalize_embeddings ? " · normalized" : ""}
          </p>
          <p className="text-zinc-500">
            outliers: {mutation.data.outlier_policy}
            {" · "}
            detected {mutation.data.outliers_detected}
            {" · "}
            dropped {mutation.data.outliers_dropped}
            {" · "}
            reassigned {mutation.data.outliers_reassigned}
          </p>
          <p className="text-zinc-500">
            {mutation.data.auto_tuned ? "auto-tune on" : "auto-tune off"}
            {mutation.data.selected_n_clusters != null ? ` · selected k ${mutation.data.selected_n_clusters}` : ""}
            {mutation.data.auto_tune_objective ? ` · ${mutation.data.auto_tune_objective}` : ""}
          </p>
          <p className="text-zinc-500">
            silhouette {mutation.data.silhouette_score != null ? mutation.data.silhouette_score.toFixed(3) : "n/a"}
            {" · "}
            davies-bouldin {mutation.data.davies_bouldin_score != null ? mutation.data.davies_bouldin_score.toFixed(3) : "n/a"}
            {" · "}
            calinski-harabasz {mutation.data.calinski_harabasz_score != null ? mutation.data.calinski_harabasz_score.toFixed(1) : "n/a"}
          </p>
          <p className="text-zinc-500">
            seed {mutation.data.random_state_used ?? "n/a"}
            {lockRandomState ? " (locked)" : " (auto)"}
          </p>
          <div className="pt-1 border-t border-zinc-200">
            <p className="text-zinc-500 mb-1">Cluster sizes</p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(mutation.data.label_counts)
                .sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([label, size]) => (
                  <span
                    key={label}
                    className="px-1.5 py-0.5 rounded bg-white text-zinc-700 border border-zinc-300"
                  >
                    {label}: {size}
                  </span>
                ))}
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
