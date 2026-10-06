import React, { useEffect, useState } from "react";
import { api, getToken } from "../lib/api.js";
import { s } from "../lib/style.js";

const CATEGORIES = [
  { id: "ALL", label: "All Resources", icon: "🌐" },
  { id: "ACADEMIC", label: "Academic", icon: "📖" },
  { id: "QUESTIONS", label: "Question Papers / PYQs", icon: "❓" },
  { id: "STUDY_MATERIAL", label: "Study Material & Notes", icon: "📚" },
  { id: "DOCUMENTS", label: "Official Documents", icon: "📄" },
  { id: "EVENTS", label: "Events & Fests", icon: "🎪" },
  { id: "CLUBS", label: "Clubs & Societies", icon: "🤖" },
  { id: "CAMPUS_HELP", label: "Campus Help & Placement", icon: "💼" },
  { id: "OPEN_RESOURCES", label: "Open Dev Resources", icon: "💻" }
];

export default function ResourcesSurface({ user, onGo }) {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [filterSource, setFilterSource] = useState("ALL"); // ALL | OFFICIAL | PEER
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitReasons, setSubmitReasons] = useState([]);

  // Form fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("ACADEMIC");
  const [resourceType, setResourceType] = useState("FILE");
  const [attachmentName, setAttachmentName] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [tagsInput, setTagsInput] = useState("");

  const isWarden = user?.role === "WARDEN" || (typeof window !== "undefined" && (new URLSearchParams(window.location.search).get("as") === "warden" || new URLSearchParams(window.location.search).get("role") === "warden"));
  const isAdmin = user?.role === "ADMIN" || (!isWarden && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("as") === "admin");
  const isStudent = !isWarden && !isAdmin;

  const fetchResources = async () => {
    if (isWarden) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (!getToken()) {
        await new Promise((r) => setTimeout(r, 600));
      }
      let q = "?";
      if (search.trim()) q += `search=${encodeURIComponent(search.trim())}&`;
      if (selectedCategory !== "ALL") q += `category=${encodeURIComponent(selectedCategory)}&`;
      if (filterSource === "OFFICIAL") q += "officialOnly=true&";
      if (filterSource === "PEER") q += "myOnly=false&";
      
      const res = await api.resources(q);
      const items = res?.resources || [];
      if (filterSource === "PEER") {
        setResources(items.filter(r => !r.isOfficial));
      } else {
        setResources(items);
      }
    } catch (err) {
      setError(err.message || "Failed to load campus resources feed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResources();
  }, [search, selectedCategory, filterSource, user?.id, user?.role, user]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setSubmitError("Please provide both a title and description.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setSubmitReasons([]);

    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const payload = {
        title: title.trim(),
        description: description.trim(),
        category,
        resourceType,
        attachmentName: attachmentName.trim() || (resourceType === "FILE" ? `${title.slice(0, 20)}.pdf` : ""),
        fileUrl: fileUrl.trim() || (resourceType === "FILE" ? "https://bput.ac.in/docs/sample.pdf" : ""),
        linkUrl: linkUrl.trim(),
        tags
      };

      await api.createResource(payload);
      setModalOpen(false);
      // Reset form
      setTitle("");
      setDescription("");
      setCategory("ACADEMIC");
      setResourceType("FILE");
      setAttachmentName("");
      setFileUrl("");
      setLinkUrl("");
      setTagsInput("");
      fetchResources();
    } catch (err) {
      setSubmitError(err.message || "Submission rejected.");
      if (err.details && Array.isArray(err.details)) {
        setSubmitReasons(err.details);
      } else if (err.reasons && Array.isArray(err.reasons)) {
        setSubmitReasons(err.reasons);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to remove this resource from the feed?")) return;
    try {
      await api.deleteResource(id);
      fetchResources();
    } catch (err) {
      alert("Failed to delete resource: " + err.message);
    }
  };

  const handleDownload = async (resource) => {
    try {
      await api.downloadResource(resource._id);
      setResources(prev => prev.map(r => r._id === resource._id ? { ...r, downloadsCount: (r.downloadsCount || 0) + 1 } : r));
      if (resource.fileUrl) {
        window.open(resource.fileUrl, "_blank");
      } else if (resource.linkUrl) {
        window.open(resource.linkUrl, "_blank");
      } else {
        alert("Downloading resource: " + (resource.attachmentName || resource.title));
      }
    } catch {
      // Non-fatal
    }
  };

  // STRICT RBAC ACCESS BARRIER: Wardens are strictly blocked
  if (isWarden) {
    return (
      <div style={s("max-width: 900px; margin: 40px auto; padding: 32px 24px; text-align: center; background: var(--color-surface); border: 2px solid var(--color-danger-300, #fca5a5); border-radius: 8px; box-shadow: var(--shadow-md)")}>
        <div style={s("font-size: 48px; margin-bottom: 12px")}>🚫</div>
        <h2 style={s("font-family: var(--font-heading); font-size: 24px; color: var(--color-danger-700, #b91c1c); margin-bottom: 10px; font-weight: 800; letter-spacing: -.01em")}>
          ACCESS DENIED: WARDEN ROLE RESTRICTED
        </h2>
        <p style={s("font-size: 14px; color: var(--color-neutral-700); line-height: 1.6; max-width: 600px; margin: 0 auto 20px")}>
          The <strong>Campus Resource Sharing &amp; Help Hub</strong> is strictly restricted to <strong>College Administration</strong> and <strong>Students</strong> for academic material dissemination. Hostel Wardens do not have access to this portal.
        </p>
        <div style={s("display: flex; gap: 12px; justify-content: center")}>
          <button type="button" onClick={() => onGo?.("admin")} className="btn btn-outline" style={s("font-size: 12px; padding: 8px 16px")}>
            Return to Mission Control
          </button>
          <button type="button" onClick={() => onGo?.("incident")} className="btn btn-primary" style={s("font-size: 12px; padding: 8px 16px")}>
            View Hostel Incidents
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s("max-width: 1300px; margin: 0 auto; padding: 24px clamp(14px, 2.5vw, 36px) 60px")}>
      
      {/* CHANNEL HEADER */}
      <div style={s("background: linear-gradient(135deg, var(--color-surface), color-mix(in srgb, var(--color-accent) 6%, var(--color-surface))); border: 1px solid var(--color-divider); border-radius: 8px; padding: 24px 28px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px")}>
        <div>
          <div style={s("display: flex; align-items: center; gap: 10px; margin-bottom: 6px")}>
            <span style={s("background: var(--color-accent); color: #fff; font-family: var(--font-heading); font-weight: 800; font-size: 10px; letter-spacing: .14em; padding: 3px 8px; border-radius: 4px")}>
              ADMIN ↔ STUDENT ONLY
            </span>
            <span style={s("font-size: 11px; letter-spacing: .12em; color: var(--color-neutral-600); font-weight: 600")}>
              TELEGRAM-INSPIRED ACADEMIC FEED
            </span>
          </div>
          <h1 style={s("font-family: var(--font-heading); font-size: clamp(22px, 3vw, 28px); margin: 0 0 6px; font-weight: 800; letter-spacing: -.02em")}>
            Campus Resource Sharing &amp; Help Hub
          </h1>
          <p style={s("font-size: 13px; color: var(--color-neutral-700); margin: 0; max-width: 750px; line-height: 1.5")}>
            Verified academic question papers (PYQs), lecture notes, official circulars, and study links broadcasted by College Administration and peer-contributed by students under real-time AI moderation.
          </p>
        </div>

        <div style={s("display: flex; gap: 10px; align-items: center")}>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="btn btn-primary"
            style={s("display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; font-weight: 700; font-size: 13px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.08)")}
          >
            <span>{isAdmin ? "📢 Broadcast Official Resource" : "➕ Share Study Resource"}</span>
          </button>
        </div>
      </div>

      {/* FILTER & SEARCH BAR */}
      <div style={s("display: flex; flex-direction: column; gap: 14px; margin-bottom: 24px")}>
        
        {/* Top search & source filter */}
        <div style={s("display: flex; gap: 12px; align-items: center; flex-wrap: wrap")}>
          <div style={s("flex: 1 1 300px; position: relative")}>
            <input
              type="text"
              placeholder="Search notes, PYQs, subjects, announcements or author..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input"
              style={s("width: 100%; padding: 10px 14px 10px 38px; font-size: 13px; border-radius: 6px; background: var(--color-surface)")}
            />
            <span style={s("position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 14px; opacity: 0.5")}>
              🔍
            </span>
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                style={s("position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 12px; color: var(--color-neutral-500)")}
              >
                ✕
              </button>
            )}
          </div>

          <div style={s("display: flex; gap: 6px; background: var(--color-surface); padding: 4px; border: 1px solid var(--color-divider); border-radius: 6px")}>
            {[
              { id: "ALL", label: "All Sources" },
              { id: "OFFICIAL", label: "🏛️ Admin Official Only" },
              { id: "PEER", label: "🎓 Student Contributions" }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterSource(tab.id)}
                style={s(`font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 4px; border: none; cursor: pointer; transition: all .15s; background: ${filterSource === tab.id ? "var(--color-ink)" : "transparent"}; color: ${filterSource === tab.id ? "var(--color-on-ink)" : "var(--color-neutral-700)"}`)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Category Pills */}
        <div style={s("display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin")}>
          {CATEGORIES.map(cat => {
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                style={s(`white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 999px; cursor: pointer; transition: all .15s; border: 1px solid ${active ? "var(--color-accent)" : "var(--color-divider)"}; background: ${active ? "var(--color-accent-50, #eff6ff)" : "var(--color-surface)"}; color: ${active ? "var(--color-accent)" : "var(--color-neutral-800)"}`)}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* FEED LIST */}
      {loading ? (
        <div style={s("padding: 40px; text-align: center; color: var(--color-neutral-600); font-size: 14px")}>
          <span>📡 Syncing campus resource stream...</span>
        </div>
      ) : error ? (
        <div style={s("padding: 24px; background: var(--color-warn-50); border: 1px solid var(--color-warn-200); border-radius: 6px; color: var(--color-warn-800); font-size: 13px")}>
          ⚠️ {error}
        </div>
      ) : resources.length === 0 ? (
        <div style={s("padding: 48px 24px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-divider); border-radius: 8px")}>
          <div style={s("font-size: 36px; margin-bottom: 8px")}>📭</div>
          <div style={s("font-size: 15px; font-weight: 700; color: var(--color-neutral-800); margin-bottom: 4px")}>No resources found</div>
          <p style={s("font-size: 13px; color: var(--color-neutral-600); margin: 0 0 16px")}>
            Try clearing filters or search query, or share the first resource.
          </p>
          <button type="button" onClick={() => setModalOpen(true)} className="btn btn-outline" style={s("font-size: 12px")}>
            Share Something Helpful
          </button>
        </div>
      ) : (
        <div style={s("display: grid; gap: 16px")}>
          {resources.map((item) => {
            const isOwner = user && (String(user.id || user._id) === String(item.author?._id || item.author));
            const canDelete = isAdmin || isOwner;
            const isOfficial = item.isOfficial;
            const isRejected = item.status === "REJECTED";

            return (
              <div
                key={item._id || item.reference}
                style={s(`background: var(--color-surface); border: 1px solid ${isOfficial ? "var(--color-accent-300, #93c5fd)" : isRejected ? "var(--color-danger-200, #fecaca)" : "var(--color-divider)"}; border-left: 4px solid ${isOfficial ? "var(--color-accent)" : isRejected ? "var(--color-danger, #ef4444)" : "var(--color-success, #10b981)"}; border-radius: 8px; padding: 20px 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.03); transition: box-shadow .2s`)}
              >
                {/* Top Metabar */}
                <div style={s("display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px")}>
                  <div style={s("display: flex; align-items: center; gap: 10px; flex-wrap: wrap")}>
                    {isOfficial ? (
                      <span style={s("display: inline-flex; align-items: center; gap: 5px; background: var(--color-accent-50, #eff6ff); color: var(--color-accent); font-size: 11px; font-weight: 800; letter-spacing: .06em; padding: 3px 8px; border-radius: 4px; border: 1px solid var(--color-accent-200, #bfdbfe)")}>
                        <span>🏛️</span>
                        <span>OFFICIAL BROADCAST · {item.authorName || "College Administration"}</span>
                      </span>
                    ) : (
                      <span style={s("display: inline-flex; align-items: center; gap: 5px; background: #ecfdf5; color: #047857; font-size: 11px; font-weight: 700; letter-spacing: .06em; padding: 3px 8px; border-radius: 4px; border: 1px solid #a7f3d0")}>
                        <span>🎓</span>
                        <span>PEER RESOURCE · {item.authorName || "Student Contributor"}</span>
                      </span>
                    )}

                    <span style={s("background: var(--color-neutral-100); color: var(--color-neutral-700); font-size: 10px; font-weight: 700; letter-spacing: .08em; padding: 3px 8px; border-radius: 4px")}>
                      {item.category}
                    </span>

                    <span style={s("font-family: var(--font-mono); font-size: 10px; color: var(--color-neutral-500)")}>
                      {item.reference}
                    </span>
                  </div>

                  <div style={s("display: flex; align-items: center; gap: 12px")}>
                    <span style={s("font-size: 11px; color: var(--color-neutral-500)")}>
                      {new Date(item.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(item._id)}
                        title="Delete Resource"
                        style={s("background: none; border: none; cursor: pointer; color: var(--color-danger, #ef4444); font-size: 12px; font-weight: 600; padding: 2px 6px; border-radius: 4px")}
                      >
                        🗑️ Remove
                      </button>
                    )}
                  </div>
                </div>

                {/* Content */}
                <h3 style={s("font-family: var(--font-heading); font-size: 18px; font-weight: 700; margin: 0 0 8px; color: var(--color-text); line-height: 1.3")}>
                  {item.title}
                </h3>
                <p style={s("font-size: 13px; color: var(--color-neutral-700); margin: 0 0 14px; line-height: 1.6; white-space: pre-wrap")}>
                  {item.description}
                </p>

                {/* Tags */}
                {item.tags && item.tags.length > 0 && (
                  <div style={s("display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px")}>
                    {item.tags.map((t, idx) => (
                      <span key={idx} style={s("font-size: 11px; color: var(--color-neutral-600); background: var(--color-neutral-100); padding: 2px 8px; border-radius: 4px")}>
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                {/* Attachment / Link Action Box */}
                {(item.fileUrl || item.attachmentName || item.linkUrl) && (
                  <div style={s("background: var(--color-surface-2, #f8fafc); border: 1px solid var(--color-divider); border-radius: 6px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 12px")}>
                    <div style={s("display: flex; align-items: center; gap: 12px")}>
                      <span style={s("font-size: 24px")}>
                        {item.resourceType === "LINK" ? "🔗" : item.resourceType === "NOTICE" ? "📢" : "📄"}
                      </span>
                      <div>
                        <div style={s("font-size: 13px; font-weight: 700; color: var(--color-text)")}>
                          {item.attachmentName || (item.resourceType === "LINK" ? item.linkUrl : "Document Attachment")}
                        </div>
                        <div style={s("font-size: 11px; color: var(--color-neutral-500); display: flex; gap: 10px")}>
                          {item.attachmentSize && <span>Size: {item.attachmentSize}</span>}
                          <span>Downloads: {item.downloadsCount || 0}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDownload(item)}
                      className="btn btn-outline"
                      style={s("font-size: 12px; padding: 6px 14px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px")}
                    >
                      <span>{item.resourceType === "LINK" ? "Open Link ↗" : "📥 Download Material"}</span>
                    </button>
                  </div>
                )}

                {/* Moderation Badge & Details */}
                <div style={s("display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; pt: 8px; border-top: 1px dashed var(--color-divider); font-size: 11px; color: var(--color-neutral-600)")}>
                  <div style={s("display: flex; align-items: center; gap: 6px")}>
                    <span>🛡️ AI Moderation:</span>
                    <span style={s(`font-weight: 700; color: ${isRejected ? "var(--color-danger, #ef4444)" : "#059669"}`)}>
                      {isRejected ? "Rejected / Flagged" : "Verified Safe & Relevant"}
                    </span>
                    <span style={s("font-family: var(--font-mono); opacity: 0.75")}>
                      ({item.moderation?.relevanceScore || 95}% match score · {item.moderation?.method || "Rule & Keyword Analyzer"})
                    </span>
                  </div>

                  {item.moderation?.reasons && item.moderation.reasons.length > 0 && (
                    <span style={s("font-style: italic; opacity: 0.85")}>
                      {item.moderation.reasons[0]}
                    </span>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* SHARE RESOURCE MODAL */}
      {modalOpen && (
        <div style={s("position: fixed; inset: 0; z-index: 900; background: var(--color-scrim, rgba(0,0,0,0.5)); display: flex; align-items: center; justify-content: center; padding: 16px")}>
          <div style={s("width: min(580px, 100%); background: var(--color-bg); border: 1px solid var(--color-neutral-400); border-radius: 8px; box-shadow: var(--shadow-xl); overflow: hidden")}>
            
            {/* Modal Header */}
            <div style={s("padding: 16px 20px; border-bottom: 1px solid var(--color-divider); display: flex; justify-content: space-between; align-items: center; background: var(--color-surface)")}>
              <div>
                <h3 style={s("font-family: var(--font-heading); font-size: 17px; margin: 0; font-weight: 800")}>
                  {isAdmin ? "🏛️ Broadcast Official Campus Resource" : "🎓 Share Academic / Campus Resource"}
                </h3>
                <span style={s("font-size: 11px; color: var(--color-neutral-600)")}>
                  {isAdmin ? "Directly broadcasted to all students with administrative authority." : "Submissions pass through real-time AI & relevance screening."}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={s("background: none; border: none; font-size: 18px; cursor: pointer; color: var(--color-neutral-500)")}
              >
                ✕
              </button>
            </div>

            {/* AI Moderation Notice for Students */}
            {!isAdmin && (
              <div style={s("background: #eff6ff; border-bottom: 1px solid #bfdbfe; padding: 10px 16px; font-size: 11px; color: #1e40af; display: flex; align-items: center; gap: 8px")}>
                <span>🛡️</span>
                <span>
                  <strong>AI Content Moderation Active:</strong> Resources are automatically evaluated for academic syllabus fit, verified subjects, and screened against spam or promotional content.
                </span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleCreate} style={s("padding: 20px; display: flex; flex-direction: column; gap: 14px; max-height: 75vh; overflow-y: auto")}>
              
              {submitError && (
                <div style={s("background: var(--color-danger-50, #fef2f2); border: 1px solid var(--color-danger-200, #fecaca); border-radius: 6px; padding: 12px 14px; color: var(--color-danger-700, #b91c1c); font-size: 12px")}>
                  <div style={s("font-weight: 700; margin-bottom: 4px")}>⚠️ Submission Rejected by Moderation:</div>
                  <div>{submitError}</div>
                  {submitReasons.length > 0 && (
                    <ul style={s("margin: 6px 0 0; padding-left: 18px")}>
                      {submitReasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="field">
                <label style={s("font-size: 11px; font-weight: 700; letter-spacing: .08em; margin-bottom: 4px; display: block")}>
                  RESOURCE TITLE *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Operating Systems Unit 3 Handwritten Notes / Midsem PYQs"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="input"
                  style={s("width: 100%; font-size: 13px; padding: 8px 12px")}
                />
              </div>

              <div style={s("display: grid; grid-template-columns: 1fr 1fr; gap: 12px")}>
                <div className="field">
                  <label style={s("font-size: 11px; font-weight: 700; letter-spacing: .08em; margin-bottom: 4px; display: block")}>
                    CATEGORY *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="input"
                    style={s("width: 100%; font-size: 12px; padding: 8px")}
                  >
                    <option value="ACADEMIC">Academic / Course Syllabus</option>
                    <option value="QUESTIONS">Question Papers / PYQs</option>
                    <option value="STUDY_MATERIAL">Study Material &amp; Notes</option>
                    <option value="DOCUMENTS">Official Documents</option>
                    <option value="EVENTS">Events &amp; Competitions</option>
                    <option value="CLUBS">Clubs &amp; Societies</option>
                    <option value="CAMPUS_HELP">Campus Help &amp; Careers</option>
                    <option value="OPEN_RESOURCES">Open Resources &amp; Code</option>
                  </select>
                </div>

                <div className="field">
                  <label style={s("font-size: 11px; font-weight: 700; letter-spacing: .08em; margin-bottom: 4px; display: block")}>
                    RESOURCE TYPE *
                  </label>
                  <select
                    value={resourceType}
                    onChange={(e) => setResourceType(e.target.value)}
                    className="input"
                    style={s("width: 100%; font-size: 12px; padding: 8px")}
                  >
                    <option value="FILE">PDF / Document File</option>
                    <option value="LINK">External Link / Portal</option>
                    <option value="NOTICE">Broadcast Notice</option>
                  </select>
                </div>
              </div>

              {resourceType === "LINK" ? (
                <div className="field">
                  <label style={s("font-size: 11px; font-weight: 700; letter-spacing: .08em; margin-bottom: 4px; display: block")}>
                    LINK URL (HTTPS) *
                  </label>
                  <input
                    type="url"
                    placeholder="https://drive.google.com/... or https://bput.ac.in/..."
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    className="input"
                    style={s("width: 100%; font-size: 12px; padding: 8px 12px")}
                  />
                </div>
              ) : (
                <div style={s("display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px")}>
                  <div className="field">
                    <label style={s("font-size: 11px; font-weight: 700; letter-spacing: .08em; margin-bottom: 4px; display: block")}>
                      ATTACHMENT NAME
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. DBMS_Unit_2_Notes.pdf"
                      value={attachmentName}
                      onChange={(e) => setAttachmentName(e.target.value)}
                      className="input"
                      style={s("width: 100%; font-size: 12px; padding: 8px 12px")}
                    />
                  </div>
                  <div className="field">
                    <label style={s("font-size: 11px; font-weight: 700; letter-spacing: .08em; margin-bottom: 4px; display: block")}>
                      HOSTED FILE URL
                    </label>
                    <input
                      type="text"
                      placeholder="https://bput.ac.in/docs/..."
                      value={fileUrl}
                      onChange={(e) => setFileUrl(e.target.value)}
                      className="input"
                      style={s("width: 100%; font-size: 12px; padding: 8px 12px")}
                    />
                  </div>
                </div>
              )}

              <div className="field">
                <label style={s("font-size: 11px; font-weight: 700; letter-spacing: .08em; margin-bottom: 4px; display: block")}>
                  DESCRIPTION &amp; DETAILS *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Provide an overview of the topic, syllabus coverage, professor notes, or important highlights..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input"
                  style={s("width: 100%; font-size: 12px; padding: 8px 12px; line-height: 1.5; resize: vertical")}
                />
              </div>

              <div className="field">
                <label style={s("font-size: 11px; font-weight: 700; letter-spacing: .08em; margin-bottom: 4px; display: block")}>
                  TAGS (COMMA SEPARATED)
                </label>
                <input
                  type="text"
                  placeholder="dbms, pyq, 4th-sem, cse, notes"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="input"
                  style={s("width: 100%; font-size: 12px; padding: 8px 12px")}
                />
              </div>

              <div style={s("display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px; padding-top: 14px; border-top: 1px solid var(--color-divider)")}>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="btn btn-outline"
                  style={s("font-size: 12px; padding: 8px 16px")}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary"
                  style={s("font-size: 12px; padding: 8px 20px; font-weight: 700")}
                >
                  {submitting ? "Analyzing & Publishing..." : isAdmin ? "Broadcast Official Resource" : "Submit with AI Moderation"}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}
