/* One interface language per visitor.

The static HTML is English, which is what a crawler or a browser without
JavaScript reads. This script switches labels, headings, and buttons. It does
not rewrite a post: job, talent, and company text stays as it was written.

Choice order: a ?ui=en or ?ui=zh link, then the language button's saved
choice in localStorage, then the first preferred language. A tag whose
primary subtag is zh (zh, zh-CN, zh-Hans, zh-TW) selects Chinese. Anything
else, including an empty list, stays English.
*/

(function () {
  var STORAGE_KEY = "openjob-ui";

  var STRINGS = {
    en: {
      kicker: "OpenJob",
      hero: "The open job index for AI agents",
      deck: "Real jobs, linked to the employer's own page, checked daily. Free for everyone.",
      findMe: "Find me a job",
      postRole: "Post our role",
      addMine: "Let the right job find me",
      byHand: "Do it by hand",
      tabs: { all: "All", job: "Jobs", talent: "Talent", company: "Companies" },
      kind: { job: "Job", talent: "Talent", company: "Company" },
      q: "Role, skill, or keyword",
      location: "Location",
      remote: "Remote",
      language: "Language",
      tag: "Tag",
      origin: "Source",
      originOpt: { all: "All sources", owner: "Posted on OpenJob", indexed: "Indexed" },
      indexedBadge: function (hours) { return "Indexed · checked " + hours + "h ago"; },
      department: "Department",
      any: "Any",
      remoteOpt: { remote: "Remote", onsite: "On-site", hybrid: "Hybrid", unspecified: "Not set" },
      employment: {
        FULL_TIME: "Full-time",
        PART_TIME: "Part-time",
        CONTRACTOR: "Contractor",
        TEMPORARY: "Temporary",
        INTERN: "Intern",
        VOLUNTEER: "Volunteer",
        PER_DIEM: "Per diem",
        OTHER: "Other",
      },
      totalJobs: function (n) { return n.toLocaleString() + " open jobs indexed"; },
      count: function (n, total) { return n.toLocaleString() + " shown · " + total.toLocaleString() + " results"; },
      loadMore: "Load more",
      empty: "Nothing matches these filters.",
      emptyLead: {
        all: "No posts yet.",
        job: "No jobs yet.",
        talent: "No profiles yet.",
        company: "No company pages yet.",
      },
      postJob: "Post a job",
      addProfile: "Add your profile",
      looking: "I am looking for a job",
      hiring: "I am hiring",
      audienceLabel: "Choose an audience",
      findTalents: "Search Talents",
      githubAccount: "No account is needed to publish a profile through the API or remote MCP. GitHub is only needed for the optional PR workflow.",
      useAgent: "Use your AI agent",
      agentFind: "Find jobs",
      agentJob: "Job",
      agentTalent: "Talent profile",
      agentCompany: "Company",
      agentCopy: "Copy prompt",
      agentCopied: "Copied",
      agentFallback: "Profile publishing also works through the anonymous API or remote MCP. GitHub is only needed for the pull request option.",
      agentFindFallback: "This prompt does not open a pull request. The agent reads the public index and returns matching permalinks.",
      agentIndex: "Read the live index",
      agentNew: "Create the file on GitHub",
      agentPrompt: {
        find: function () {
          return "Read https://openjob.softprobe.ai/llms.txt and follow it. If the OpenJob MCP server is connected, use list_jobs. Otherwise GET https://openjob.softprobe.ai/api/v1/jobs for a bounded page, or download the complete dataset from https://openjob.softprobe.ai/api/data/manifest.json when code execution is available. If the API is not active, GET https://openjob.softprobe.ai/index.json. Choose your own matching method; OpenJob does not rank results. Return each match with its permalink and the apply method already on that post. Do not invent an email or a phone number. Resume or bio: <paste here>";
        },
        talentSearch: function () {
          return "Read https://openjob.softprobe.ai/llms.txt and follow it. If the OpenJob MCP server is connected, use list_talent. Otherwise GET https://openjob.softprobe.ai/api/v1/talent for a bounded page, or download the complete dataset from https://openjob.softprobe.ai/api/data/manifest.json when code execution is available. Choose your own matching method. Return each profile with its permalink and the contact links already on the profile. Do not invent an email or phone number. Role: <paste here>";
        },
        talent: function () {
          return "Read https://openjob.softprobe.ai/llms.txt and follow it. If I provide a PDF or Word resume, LinkedIn profile, or bio, extract fields in the create_talent request schema at https://openjob.softprobe.ai/api/openapi.json, including body_markdown with ## About, ## Experience, and ## Education sections. Put a concise factual summary first and use flat Markdown bullets for experience. Omit missing details and omit Education when no details are supplied or I do not want them shown. Do not upload or store the source document, invent facts, or include an email or phone. Ask only for required fields you cannot infer. Show me the exact public profile; explain CC BY 4.0, 180-day expiry, and that deletion cannot recall downloaded copies; then ask for my approval before publishing. After I approve, if the OpenJob remote MCP is connected, call create_talent; otherwise POST the same JSON to https://openjob.softprobe.ai/api/v1/talent with consent_to_publish=true. No GitHub account or API key is needed. Tell me the profile permalink and show the private delete token once so I can save it. If I prefer GitHub, use the existing PR workflow instead. Resume or profile: <paste or attach here>";
        },
        job: function (origin) {
          return "Read https://openjob.softprobe.ai/llms.txt and follow it. Prepare one job post and show me the exact Markdown. Open one pull request with my connected GitHub account only after I approve it. If you cannot use a connected GitHub account, give me the Markdown and this new-file link: https://github.com/softprobe/openjob/new/main/jobs. Set posted_by to the login that opens the pull request. If the company page exists, that login must be in its owners list. Role: <paste here>";
        },
        company: function (origin) {
          return "Read " + origin + "llms.txt and follow it. Turn the details below into an OpenJob company page. Set owners to GitHub logins that include the account opening the pull request, and posted_by to that same login. A new company page is reviewed once. Open one pull request to github.com/softprobe/openjob. Details: <paste here>";
        },
      },
      missing: "The index is not here yet. GitHub Pages builds it from the posts. Locally, from the repo root: python -m validator build-index --root . --out site/index.json",
      federated: "Own repo",
      apply: "Apply",
      applyEmail: "Apply by email",
      howToApply: "How to apply",
      alsoProfile: "Also add your profile",
      copyEmail: "Copy email",
      copied: "Copied",
      website: "Website",
      github: "GitHub",
      linkedin: "LinkedIn",
      profile: "Profile",
      reachNote: "This board does not list an email or a phone number. Reach this person through the GitHub, LinkedIn, or website link.",
      openTo: {
        "full-time": "Full-time",
        "part-time": "Part-time",
        contract: "Contract",
        internship: "Internship",
      },
      source: "Source",
      posted: "Posted",
      expires: "Expires",
      footer: "Phone numbers are not allowed. A job may show Apply by email when the address is on the company domain. Share text never includes a phone number or an email. Posts are CC BY 4.0. Code is MIT.",
      share: "Share",
      shareNote: "The buttons send this text and the permalink. They do not send an apply link, a phone number, or an email address. An Apply by email button on this page is not part of this text.",
      copy: "Copy link",
      wechat: "WeChat",
      wechatHelp: "Scan with WeChat. This code is the permalink, drawn in your browser.",
      wechatPaste: "Copy the link and paste it into WeChat.",
      permalink: "Permalink",
      qrLabel: "QR code for this permalink",
      board: "Board",
      about: "About",
      feed: "Feed",
      jobsFeed: "New jobs",
      talentsFeed: "New profiles",
      skipResults: "Skip to results",
      skipShare: "Skip to share",
      postType: "Post type",
      openJobs: "Open jobs",
      openJobsMore: "The jobs archive lists every open role.",
      previous: "Previous",
      next: "Next",
      pageOf: function (n, pages) { return "Page " + n + " of " + pages; },
      archive: {
        job: function (n) { return "Jobs archive, " + n + " posts"; },
        talent: function (n) { return "Talent archive, " + n + " posts"; },
        company: function (n) { return "Companies archive, " + n + " posts"; },
      },
      notFound: "Not found",
      notFoundBody: "That page is not on the board. It may have expired, or the address may be wrong.",
      back: "Back to the board",
      aboutWhat: "What is OpenJob?",
      aboutWhatBody: "The open job index for AI agents. Real jobs, linked to the employer's own page, checked daily. Free for everyone.",
      aboutPost: "How do I post a job or a talent profile?",
      aboutPostBody: "Jobs and company pages use the GitHub pull request workflow. Talent profiles can also be published through the anonymous API or remote MCP without an account.",
      aboutApply: "How do I apply?",
      aboutApplyBody: "The job page shows the method. That is an email on the company domain, an https link, or both. A link to this board's profile guide is not an application.",
      aboutProfile: "How do I add a profile?",
      aboutProfileBody: "You can publish a profile through the anonymous API or remote MCP without an account, or use the GitHub pull request workflow. Profiles are public, contain no email or phone, and expire after 180 days. A profile is not a job application.",
      aboutFeeds: "How do I hear about new posts?",
      aboutFeedsBody: "Repository posts are in jobs.xml, talents.xml, and feed.xml. API-submitted profiles are available through the complete talent dataset and the OpenJob API. The GitHub catalog is index.json.",
      aboutPrivacy: "Why are phone numbers and personal emails rejected?",
      aboutPrivacyBody: "The board is public. Phone numbers are never accepted. Talent posts cannot contain an email. A job may list one hiring address, and only when that domain matches the company website.",
      aboutDuration: "How long does a post stay up?",
      aboutLanguages: "Can a post be in English and Chinese?",
      aboutIndex: "How does the index work?",
      aboutIndexBody: "OpenJob reads public job feeds from Greenhouse, Lever, Ashby, and Workable once a day. It stores the title, company, location, department, type, dates, and the link to the employer's page. It does not store the job description or anyone's name. A role that disappears from a healthy feed is closed. A feed that fails stays up for 48 hours and is then hidden. Indexed jobs are labeled and link out. They are not posts on OpenJob, and CC BY does not cover them. Moka, Feishu Hire, and Beisen do not publish a feed like these four, so this pass covers few jobs in China. Owner posts remain how a company there lists a role.",
      aboutClaim: "How does a company claim its page?",
      aboutClaimBody: "Add or edit <code>companies/&lt;letter&gt;/&lt;slug&gt;.md</code> and set <code>owners</code> to the GitHub logins that should control it. Publish <code>https://&lt;company-domain&gt;/.well-known/openjob.txt</code> with one login per line. The checker reads that file. When every owner is listed, the pull request can auto-merge. Otherwise a maintainer reviews it. After a claim, <code>index: \"off\"</code> stops indexing that company's board.",
      aboutOptOut: "How does a company opt out?",
      aboutOptOutBody: "Open a GitHub issue, or a pull request that adds the board to <code>sources/denylist.yml</code>. A maintainer removes it. The aim is to do that within 24 hours. Claiming the page and setting <code>index: \"off\"</code> does the same thing for a company that wants to keep the page.",
      aboutWho: "Who maintains this?",
    },
    zh: {
      kicker: "OpenJob",
      hero: "面向 AI 代理的开放职位索引",
      deck: "真实职位，链到雇主自己的页面，每天检查。对所有人免费。",
      findMe: "帮我找工作",
      postRole: "发布我们的职位",
      addMine: "让好工作找到我",
      byHand: "自己动手",
      tabs: { all: "全部", job: "职位", talent: "人才", company: "公司" },
      kind: { job: "职位", talent: "人才", company: "公司" },
      q: "职位、技能或关键词",
      location: "地点",
      remote: "远程",
      language: "语言",
      tag: "标签",
      origin: "来源",
      originOpt: { all: "全部来源", owner: "发布在 OpenJob", indexed: "索引" },
      indexedBadge: function (hours) { return "索引 · " + hours + " 小时前检查"; },
      department: "部门",
      any: "不限",
      remoteOpt: { remote: "远程", onsite: "到岗", hybrid: "混合", unspecified: "未标明" },
      employment: {
        FULL_TIME: "全职",
        PART_TIME: "兼职",
        CONTRACTOR: "合同工",
        TEMPORARY: "临时",
        INTERN: "实习",
        VOLUNTEER: "志愿",
        PER_DIEM: "按日",
        OTHER: "其他",
      },
      totalJobs: function (n) { return n.toLocaleString() + " 个在招职位已收录"; },
      count: function (n, total) { return "显示 " + n.toLocaleString() + " / " + total.toLocaleString() + " 个结果"; },
      loadMore: "加载更多",
      empty: "没有符合这些条件的帖子。",
      emptyLead: {
        all: "还没有帖子。",
        job: "还没有职位。",
        talent: "还没有人才档案。",
        company: "还没有公司页。",
      },
      postJob: "发布职位",
      addProfile: "添加档案",
      looking: "我在找工作",
      hiring: "我在招聘",
      audienceLabel: "选择你的身份",
      findTalents: "搜索人才",
      githubAccount: "通过 API 或远程 MCP 发布档案不需要账号。只有选择 Pull Request 工作流时才需要 GitHub。",
      useAgent: "使用你的 AI 助手",
      agentFind: "找职位",
      agentJob: "职位",
      agentTalent: "人才档案",
      agentCompany: "公司",
      agentCopy: "复制提示",
      agentCopied: "已复制",
      agentFallback: "如果助手不能开 Pull Request，让它输出 Markdown 文件，再用下面的 GitHub 新文件链接粘贴进去。",
      agentFindFallback: "这段提示不需要开 Pull Request。助手读取公开索引，并返回匹配的永久链接。",
      agentIndex: "阅读实时索引",
      agentNew: "在 GitHub 上新建文件",
      agentPrompt: {
        find: function () {
          return "阅读 https://openjob.softprobe.ai/llms.txt 并按它执行。如果已连接 OpenJob MCP，使用 list_jobs。否则 GET https://openjob.softprobe.ai/api/v1/jobs 获取一页结果；如果支持代码执行，从 https://openjob.softprobe.ai/api/data/manifest.json 下载完整数据并自行匹配。如果 API 未启用，GET https://openjob.softprobe.ai/index.json。OpenJob 不会排序匹配结果。每条写出永久链接，以及帖子上已有的申请方式。不要编造邮箱或电话。简历或简介：<粘贴在这里>";
        },
        talentSearch: function () {
          return "阅读 https://openjob.softprobe.ai/llms.txt 并按它执行。如果已连接 OpenJob MCP，使用 list_talent。否则 GET https://openjob.softprobe.ai/api/v1/talent 获取一页结果；如果支持代码执行，从 https://openjob.softprobe.ai/api/data/manifest.json 下载完整数据并自行匹配。列出每位候选人的永久链接和档案上已有的联系链接。不要编造邮箱或电话。职位：<粘贴在这里>";
        },
        talent: function () {
          return "阅读 https://openjob.softprobe.ai/llms.txt 并按它执行。如果我提供 PDF 或 Word 简历、LinkedIn 资料或个人简介，按 https://openjob.softprobe.ai/api/openapi.json 的 create_talent schema 提取字段，并提供 body_markdown。正文使用 ## About、## Experience，以及在我提供且愿意公开时使用 ## Education。先写简洁、真实的简介，Experience 使用不嵌套的 Markdown 项目符号。缺少的信息不要猜测；没有学历信息或我不想公开时可省略 Education。不要上传或保存原始文件、编造事实、写邮箱或电话。只询问无法推断的必填字段。先展示完整公开档案；说明 CC BY 4.0 授权、180 天后过期，以及删除无法收回已下载副本；然后征求我的发布批准。批准后，如果已连接 OpenJob 远程 MCP，就调用 create_talent；否则将相同 JSON（consent_to_publish=true）POST 到 https://openjob.softprobe.ai/api/v1/talent。无需 GitHub 账号或 API 密钥。告诉我档案链接，并只展示一次私密删除令牌供我保存。如果我偏好 GitHub，可改用现有 Pull Request 工作流。简历或资料：<粘贴或上传>";
        },
        job: function (origin) {
          return "阅读 https://openjob.softprobe.ai/llms.txt 并按它执行。准备一份岗位 Markdown 并先向我展示完整内容。只有在我批准后，才使用我已连接的 GitHub 账户开一个 Pull Request。如果没有可用的 GitHub 连接，请提供 Markdown 和这个新建岗位链接：https://github.com/softprobe/openjob/new/main/jobs。posted_by 填开 Pull Request 的登录名。公司页已存在时，该登录名必须在 owners 里。职位：<粘贴在这里>";
        },
        company: function (origin) {
          return "阅读 " + origin + "llms.txt 并按它执行。把下面的内容写成 OpenJob 公司页。owners 要包含开 Pull Request 的登录名，posted_by 也填这个登录名。新公司页会先审核一次。向 github.com/softprobe/openjob 开一个 Pull Request。内容：<粘贴在这里>";
        },
      },
      missing: "索引还没生成。GitHub Pages 会根据帖子构建。本地在仓库根目录运行：python -m validator build-index --root . --out site/index.json",
      federated: "独立仓库",
      apply: "申请",
      applyEmail: "邮件申请",
      howToApply: "如何申请",
      alsoProfile: "也可以添加档案",
      copyEmail: "复制邮箱",
      copied: "已复制",
      website: "网站",
      github: "GitHub",
      linkedin: "LinkedIn",
      profile: "档案",
      reachNote: "看板上不列出邮箱或电话。请通过 GitHub、LinkedIn 或网站链接联系。",
      openTo: {
        "full-time": "全职",
        "part-time": "兼职",
        contract: "合同",
        internship: "实习",
      },
      source: "源文件",
      posted: "发布",
      expires: "到期",
      footer: "不允许电话号码。职位可以在公司域名匹配时显示「邮件申请」。分享文字不含电话或邮箱。帖子以 CC BY 4.0 授权，代码以 MIT 授权。",
      share: "分享",
      shareNote: "按钮只发送这段文字和永久链接，不包含申请链接、电话或邮箱。页面上的「邮件申请」按钮不在这段文字里。",
      copy: "复制链接",
      wechat: "微信",
      wechatHelp: "用微信扫描。二维码是本条永久链接，由浏览器在本地生成。",
      wechatPaste: "复制链接，粘贴到微信。",
      permalink: "永久链接",
      qrLabel: "本条永久链接的二维码",
      board: "公告板",
      about: "关于",
      feed: "订阅",
      jobsFeed: "新职位",
      talentsFeed: "新档案",
      skipResults: "跳到结果",
      skipShare: "跳到分享",
      postType: "帖子类型",
      openJobs: "在招职位",
      openJobsMore: "职位归档列出全部在招职位。",
      previous: "上一页",
      next: "下一页",
      pageOf: function (n, pages) { return "第 " + n + " / " + pages + " 页"; },
      archive: {
        job: function (n) { return "职位归档，" + n + " 篇"; },
        talent: function (n) { return "人才归档，" + n + " 篇"; },
        company: function (n) { return "公司归档，" + n + " 篇"; },
      },
      notFound: "找不到",
      notFoundBody: "这个页面不在看板上。它可能已经到期，或者地址不对。",
      back: "返回看板",
      aboutWhat: "OpenJob 是什么？",
      aboutWhatBody: "面向 AI 代理的开放职位索引。真实职位，链到雇主自己的页面，每天检查。对所有人免费。",
      aboutPost: "如何发布职位或人才档案？",
      aboutPostBody: "职位和公司页通过 Pull Request 发布。人才档案也可通过匿名 API 或远程 MCP 发布，无需账号；也可以继续使用 GitHub Pull Request。",
      aboutApply: "如何申请？",
      aboutApplyBody: "申请方式写在职位页上，是公司域名上的邮箱、一个 https 链接，或两者都有。指向本看板档案说明的链接不是申请方式。",
      aboutProfile: "如何添加档案？",
      aboutProfileBody: "你可以通过匿名 API 或远程 MCP 发布人才档案，无需账号，也可以继续使用 GitHub Pull Request。档案会公开发布，不能包含邮箱或电话，并在 180 天后过期。人才档案不是职位申请。",
      aboutFeeds: "如何知道有新帖子？",
      aboutFeedsBody: "GitHub 仓库中的职位和档案可通过 <a href=\"../jobs.xml\">jobs.xml</a>、<a href=\"../talents.xml\">talents.xml</a> 和 <a href=\"../feed.xml\">feed.xml</a> 阅读。API 发布的档案可通过 OpenJob API 和完整人才数据集获取。GitHub 目录是 <a href=\"../index.json\">index.json</a>。",
      aboutPrivacy: "为什么拒绝电话和个人邮箱？",
      aboutPrivacyBody: "看板是公开的。电话一律不允许。人才帖不能写邮箱。职位最多写一个招聘邮箱，而且域名必须和公司网站一致。",
      aboutDuration: "帖子保留多久？",
      aboutDurationBody: "职位保留 60 天，人才档案保留 180 天，从 <code>posted</code> 或 <code>renewed</code> 起算。公司页一直保留，直到所有者删除。到期的帖子会被移除，页面也不再存在。",
      aboutLanguages: "一篇帖子可以中英都写吗？",
      aboutLanguagesBody: "可以。同一篇帖子可以中英都写。按钮和标题跟随浏览器：偏好中文时用中文，否则用英文。帖子正文保持作者写的语言。只有 <code>languages</code> 恰好是 <code>zh</code> 时，页面才标成中文。没有按语言拆开的网址。",
      aboutIndex: "索引如何工作？",
      aboutIndexBody: "OpenJob 每天读取 Greenhouse、Lever、Ashby 和 Workable 的公开职位源。它只保存标题、公司、地点、部门、类型、日期，以及雇主页面的链接。它不保存职位描述，也不保存任何人的姓名。健康的源里消失的职位会被关闭。失败的源保留 48 小时，然后隐藏。索引职位会标明来源并链出去。它们不是 OpenJob 上的帖子，也不适用 CC BY。Moka、飞书招聘和北森没有同类公开职位源，所以这一轮几乎覆盖不到国内职位。中国市场仍主要靠雇主自己发布的帖子。",
      aboutClaim: "公司如何认领页面？",
      aboutClaimBody: "添加或编辑 <code>companies/&lt;letter&gt;/&lt;slug&gt;.md</code>，把 <code>owners</code> 设为应控制该公司的 GitHub 登录名。在 <code>https://&lt;company-domain&gt;/.well-known/openjob.txt</code> 发布这些登录名，一行一个。检查器会读取该文件。列出全部所有者时，Pull Request 可以自动合并。否则由维护者审核。认领之后，<code>index: \"off\"</code> 会停止索引该公司的职位板。",
      aboutOptOut: "公司如何退出索引？",
      aboutOptOutBody: "开一个 GitHub issue，或者开一个 Pull Request，把该职位板加到 <code>sources/denylist.yml</code>。维护者会移除它，目标是在 24 小时内完成。认领页面并设置 <code>index: \"off\"</code> 也能让想保留页面的公司退出索引。",
      aboutWho: "谁在维护？",
      aboutWhoBody: "Softprobe 维护 <a href=\"https://github.com/softprobe/openjob\">softprobe/openjob</a>。帖子以 CC BY 4.0 授权，代码以 MIT 授权。可以 fork 这个仓库。",
    },
  };

  function lookup(table, key) {
    var node = table;
    var parts = String(key || "").split(".");
    for (var i = 0; i < parts.length; i += 1) {
      if (node == null || typeof node !== "object") return undefined;
      node = node[parts[i]];
    }
    return node;
  }

  function text(ui, key) {
    var value = lookup(STRINGS[ui] || STRINGS.en, key);
    if (value == null) value = lookup(STRINGS.en, key);
    return value;
  }

  function preferred() {
    var params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (error) {
      params = { get: function () { return null; } };
    }
    var query = params.get("ui");
    if (query === "zh" || query === "en") return query;
    try {
      var saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "zh" || saved === "en") return saved;
    } catch (error) {
      /* Storage can be blocked. Fall through to the browser languages. */
    }
    var list = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || ""];
    for (var i = 0; i < list.length; i += 1) {
      var primary = String(list[i] || "").toLowerCase().split("-")[0];
      if (primary === "zh") return "zh";
    }
    return "en";
  }

  function renderValue(value, el) {
    if (typeof value === "function") {
      return value(el.getAttribute("data-count") || "", el.getAttribute("data-pages") || "");
    }
    return value;
  }

  function apply(ui) {
    var lang = ui === "zh" ? "zh" : "en";
    var root = document.documentElement;
    if (!root.dataset.contentLang) root.dataset.contentLang = root.lang || "en";
    root.lang = lang === "zh" ? "zh" : root.dataset.contentLang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var value = text(lang, el.getAttribute("data-i18n"));
      if (value == null) return;
      if (el.getAttribute("data-i18n-html") === "1") {
        if (!el.dataset.i18nEn) el.dataset.i18nEn = el.innerHTML;
        el.innerHTML = lang === "en" ? el.dataset.i18nEn : String(renderValue(value, el));
        return;
      }
      var rendered = renderValue(value, el);
      if (typeof rendered === "string") el.textContent = rendered;
    });
    document.querySelectorAll("[data-i18n-attrs]").forEach(function (el) {
      el.getAttribute("data-i18n-attrs").split(",").forEach(function (pair) {
        var bits = pair.split(":");
        var attr = bits[0];
        var key = bits.slice(1).join(":");
        var value = text(lang, key);
        var rendered = renderValue(value, el);
        if (attr && typeof rendered === "string") el.setAttribute(attr, rendered);
      });
    });
    document.querySelectorAll("[data-lang-toggle]").forEach(function (button) {
      button.textContent = lang === "zh" ? "EN" : "中文";
      button.setAttribute("aria-pressed", lang === "zh" ? "true" : "false");
    });
  }

  function remember(ui) {
    try {
      window.localStorage.setItem(STORAGE_KEY, ui);
    } catch (error) {
      /* The choice still applies for this page view. */
    }
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.has("ui")) {
        params.delete("ui");
        var next = params.toString();
        var hash = window.location.hash || "";
        var path = window.location.pathname;
        window.history.replaceState(null, "", (next ? path + "?" + next : path) + hash);
      }
    } catch (error) {
      /* Leave the address alone when the history API is unavailable. */
    }
  }

  function bind() {
    document.querySelectorAll("[data-lang-toggle]").forEach(function (button) {
      button.addEventListener("click", function () {
        var next = preferred() === "zh" ? "en" : "zh";
        /* After a ?ui= link, preferred() would keep returning that query. */
        remember(next);
        apply(next);
        document.dispatchEvent(new CustomEvent("openjob-ui", { detail: next }));
      });
    });
  }

  window.OpenJobUI = {
    strings: STRINGS,
    preferred: preferred,
    text: function (key) { return text(preferred(), key); },
    apply: apply,
    remember: remember,
  };

  function start() {
    apply(preferred());
    bind();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
}());
