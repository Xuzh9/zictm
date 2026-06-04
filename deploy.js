const { execSync } = require('child_process');
const fs = require('fs');

function getCurrentSpace() {
  try {
    const output = execSync('cf target').toString();
    console.log('cf target 输出:', output);
    
    const spaceMatch = output.match(/space:\s*`?(\w+)`?/i);
    if (spaceMatch) {
      return spaceMatch[1].trim().toUpperCase();
    }
  } catch (error) {
    console.error('获取空间信息失败:', error.message);
  }
  return null;
}

function getExtFile(space) {
  const spaceConfig = {
    'DEV': 'mta-dev.mtaext',
    'PRD': 'mta-prd.mtaext'
  };
  return spaceConfig[space] || null;
}

function getDomainFromExtFile(extFile) {
  try {
    const extContent = fs.readFileSync(extFile, 'utf-8');
    const domainMatch = extContent.match(/domain:\s*(.+)/);
    if (domainMatch) {
      return domainMatch[1].trim();
    }
  } catch (e) {
    console.error(`读取 ${extFile} 失败:`, e.message);
  }
  return null;
}

async function main() {
  const space = getCurrentSpace();
  if (!space) {
    console.error('无法获取当前空间，请确保已登录 CF 并设置目标空间');
    process.exit(1);
  }
  
  console.log(`当前空间: ${space}`);
  
  const extFile = getExtFile(space);
  if (!extFile) {
    console.error(`未找到空间 "${space}" 对应的配置文件，支持的空间: DEV, PRD`);
    process.exit(1);
  }
  
  console.log(`使用配置文件: ${extFile}`);
  
  const domain = getDomainFromExtFile(extFile);
  if (domain) {
    console.log(`域名参数: ${domain}`);
  } else {
    console.error('警告: 未找到 domain 参数');
  }
  
  try {
    // ===================== CDS 构建 =====================
    console.log('\n=== 开始 CDS 构建 ===');
    execSync('cds build', { stdio: 'inherit' });

    // ===================== 纯构建，不加扩展文件 =====================
    console.log('\n=== 开始构建 MTA ===');
    execSync('mbt build --mtar archive', { stdio: 'inherit' });

    // ===================== 部署时加载扩展配置 =====================
    console.log('\n=== 开始部署 ===');
    execSync(`cf deploy mta_archives/archive.mtar -e ${extFile} --retries 1`, { stdio: 'inherit' });
    
    console.log('\n部署完成!');
  } catch (error) {
    console.error('部署失败:', error.message);
    process.exit(1);
  }
}

main();